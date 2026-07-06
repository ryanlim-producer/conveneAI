import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

process.env.DEEPGRAM_API_KEY = "env-dg-key";
process.env.VERCEL_AI_GATEWAY_KEY = "env-gateway-key";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

const { getAudioBufferMock } = vi.hoisted(() => ({
  getAudioBufferMock: vi.fn(),
}));

vi.mock("@/lib/s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3")>();
  return { ...actual, getAudioBuffer: getAudioBufferMock };
});

const { getAudioDurationMock, splitAudioMock } = vi.hoisted(() => ({
  getAudioDurationMock: vi.fn(),
  splitAudioMock: vi.fn(),
}));

vi.mock("@/lib/audio-split", () => ({
  getAudioDurationSeconds: getAudioDurationMock,
  splitAudioIntoChunks: splitAudioMock,
}));

import { initSchema } from "@/lib/db";
import { enqueueJob, getJob, updateJob } from "@/lib/queue";
import { processJob } from "@/lib/pipeline";

const DEEPGRAM_OK = {
  metadata: { duration: 125.5 },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: "Hola equipo. María revisa el presupuesto el viernes.",
            words: [
              { word: "hola", punctuated_word: "Hola", start: 0.1, end: 0.4, confidence: 0.99, speaker: 0 },
              { word: "equipo", punctuated_word: "equipo.", start: 0.5, end: 0.9, confidence: 0.98, speaker: 0 },
              { word: "maría", punctuated_word: "María", start: 2.0, end: 2.4, confidence: 0.97, speaker: 1 },
            ],
          },
        ],
      },
    ],
  },
};

const NAMES_REPLY = { choices: [{ message: { content: '{"Speaker 0": "Carlos", "Speaker 1": "María"}' } }] };
const ACTIONS_REPLY = {
  choices: [
    {
      message: {
        content:
          '[{"task": "Revisar el presupuesto", "assignee": "María", "deadline": "viernes", "context": "presupuesto Q3"}]',
      },
    },
  ],
};

/** fetch stub that routes Deepgram vs AI-gateway calls and records them. */
function stubExternalApis(overrides?: {
  deepgram?: () => Response;
  llm?: (body: { model: string; messages: { role: string; content: string }[] }) => Response;
}) {
  const calls: { deepgramUrls: string[]; llmBodies: { model: string; messages: { role: string; content: string }[] }[] } = {
    deepgramUrls: [],
    llmBodies: [],
  };
  let llmCall = 0;

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("api.deepgram.com")) {
      calls.deepgramUrls.push(url);
      return overrides?.deepgram
        ? overrides.deepgram()
        : new Response(JSON.stringify(DEEPGRAM_OK), { status: 200 });
    }
    if (url.includes("ai-gateway.vercel.sh")) {
      const body = JSON.parse(String(init?.body));
      calls.llmBodies.push(body);
      if (overrides?.llm) return overrides.llm(body);
      // First LLM call = speaker names, second = action items
      llmCall += 1;
      return new Response(JSON.stringify(llmCall === 1 ? NAMES_REPLY : ACTIONS_REPLY), { status: 200 });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });

  return calls;
}

describe("pipeline processJob", () => {
  let db: Database.Database;
  let userId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    getDbMock.mockReturnValue(db);

    userId = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
      userId,
      "alice@example.com",
      "x",
    );

    getAudioBufferMock.mockClear().mockResolvedValue(Buffer.from("fake-mp3-bytes"));
    getAudioDurationMock.mockClear().mockResolvedValue(120); // short file by default
    splitAudioMock.mockClear();
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function makeJob() {
    return enqueueJob({
      userId,
      filename: "standup.mp3",
      s3Key: `uploads/${userId}/j1.mp3`,
      source: "web_upload",
      language: "es",
    });
  }

  it("turns a queued job into a completed recording with transcript, speakers and action items", async () => {
    stubExternalApis();
    const job = makeJob();

    await processJob(job);

    const done = getJob(job.id)!;
    expect(done.status).toBe("done");
    expect(done.recordingId).toBeTruthy();

    const rec = db
      .prepare("SELECT * FROM recordings WHERE id = ?")
      .get(done.recordingId) as Record<string, unknown>;
    expect(rec.user_id).toBe(userId);
    expect(rec.job_id).toBe(job.id);
    expect(rec.s3_key).toBe(job.s3Key);
    expect(rec.source).toBe("web_upload");
    expect(rec.duration_seconds).toBe(125.5);
    expect(rec.speaker_count).toBe(2);
    expect(rec.transcript_text).toContain("María revisa el presupuesto");
    expect(JSON.parse(rec.segments_json as string)).toHaveLength(3);
    expect(JSON.parse(rec.speaker_map_json as string)).toEqual({
      "Speaker 0": "Carlos",
      "Speaker 1": "María",
    });
    expect(JSON.parse(rec.action_items_json as string)[0].task).toBe("Revisar el presupuesto");
  });

  it("transcribes with the user's configured Deepgram model and language", async () => {
    const calls = stubExternalApis();
    db.prepare(
      "INSERT INTO user_settings (user_id, deepgram_model, actions_llm_model, chatbot_llm_model) VALUES (?, 'nova-2-meeting', 'openai/gpt-4o', 'deepseek/deepseek-r1')",
    ).run(userId);

    const job = makeJob();
    await processJob(job);

    expect(calls.deepgramUrls[0]).toContain("model=nova-2-meeting");
    expect(calls.deepgramUrls[0]).toContain("language=es");
    expect(calls.llmBodies.every((b) => b.model === "openai/gpt-4o")).toBe(true);
    expect(getJob(job.id)!.modelUsed).toBe("nova-2-meeting");
  });

  it("fails the job when no speech is detected", async () => {
    stubExternalApis({
      deepgram: () =>
        new Response(
          JSON.stringify({
            metadata: { duration: 3 },
            results: { channels: [{ alternatives: [{ transcript: "", words: [] }] }] },
          }),
          { status: 200 },
        ),
    });
    const job = makeJob();

    await expect(processJob(job)).rejects.toThrow(/no speech/i);
    expect(db.prepare("SELECT COUNT(*) AS n FROM recordings").get()).toEqual({ n: 0 });
  });

  it("fails the job when Deepgram errors", async () => {
    stubExternalApis({
      deepgram: () => new Response("Invalid API key", { status: 401 }),
    });
    const job = makeJob();

    await expect(processJob(job)).rejects.toThrow(/deepgram/i);
  });

  it("still completes the recording when the LLM steps fail", async () => {
    stubExternalApis({
      llm: () => new Response("rate limited", { status: 500 }),
    });
    const job = makeJob();

    await processJob(job);

    const done = getJob(job.id)!;
    expect(done.status).toBe("done");
    const rec = db
      .prepare("SELECT * FROM recordings WHERE id = ?")
      .get(done.recordingId) as Record<string, unknown>;
    // best-effort fallbacks: generic speaker labels, no action items
    expect(JSON.parse(rec.speaker_map_json as string)).toEqual({
      "Speaker 0": "Speaker 0",
      "Speaker 1": "Speaker 1",
    });
    expect(JSON.parse(rec.action_items_json as string)).toEqual([]);
  });

  it("splits recordings over 30 minutes into chunks and merges the results", async () => {
    getAudioDurationMock.mockResolvedValue(3600); // 1 hour
    splitAudioMock.mockResolvedValue([Buffer.from("chunk-0"), Buffer.from("chunk-1")]);

    const CHUNK = (transcript: string, speaker: number) => ({
      metadata: { duration: 1800 },
      results: {
        channels: [
          {
            alternatives: [
              {
                transcript,
                words: [
                  { word: transcript.toLowerCase(), punctuated_word: transcript, start: 1.0, end: 2.0, confidence: 0.9, speaker },
                ],
              },
            ],
          },
        ],
      },
    });

    let dgCall = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("api.deepgram.com")) {
        dgCall += 1;
        return new Response(JSON.stringify(CHUNK(dgCall === 1 ? "Primera" : "Segunda", 0)), { status: 200 });
      }
      if (url.includes("ai-gateway.vercel.sh")) {
        const body = JSON.parse(String(init?.body));
        const isNames = body.messages[0].content.includes("real names");
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: isNames ? '{"Speaker 0": "María", "Speaker 10": "María"}' : "[]",
                },
              },
            ],
          }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });

    const job = makeJob();
    await processJob(job);

    const done = getJob(job.id)!;
    expect(done.status).toBe("done");
    expect(dgCall).toBe(2); // each chunk transcribed separately

    const rec = db
      .prepare("SELECT * FROM recordings WHERE id = ?")
      .get(done.recordingId) as Record<string, unknown>;
    expect(rec.transcript_text).toBe("Primera Segunda");
    expect(rec.duration_seconds).toBe(3600);

    const segments = JSON.parse(rec.segments_json as string);
    expect(segments[1].start).toBe(1801.0); // offset by first chunk duration
    // both chunks detected as the same speaker "María" → one normalized speaker
    expect(segments[0].speaker).toBe(segments[1].speaker);
    expect(rec.speaker_count).toBe(1);
    expect(JSON.parse(rec.speaker_map_json as string)).toEqual({ "Speaker 0": "María" });
  });

  it("passes through intermediate statuses while running", async () => {
    const seen: string[] = [];
    stubExternalApis({
      llm: (body) => {
        seen.push(getJob(jobId)!.status);
        const isNames = body.messages[0].content.includes("real names");
        return new Response(JSON.stringify(isNames ? NAMES_REPLY : ACTIONS_REPLY), { status: 200 });
      },
    });
    const job = makeJob();
    const jobId = job.id;

    await processJob(job);
    // during LLM calls the job reports processing_action_items
    expect(seen.every((s) => s === "processing_action_items")).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });
});
