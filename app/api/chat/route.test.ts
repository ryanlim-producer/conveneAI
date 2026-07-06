import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

process.env.BCRYPT_ROUNDS = "4";
process.env.VERCEL_AI_GATEWAY_KEY = "env-gateway-key";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { registerUser } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { GET as getChat, POST as postChat } from "@/app/api/chat/[recordingId]/route";

describe("/api/chat/[recordingId]", () => {
  let db: Database.Database;
  let cookie: string;
  let userId: string;
  let recordingId: string;
  let llmRequests: { model: string; messages: { role: string; content: string }[] }[];

  function insertRecording(owner: string, overrides: Record<string, unknown> = {}): string {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO recordings (id, user_id, filename, source, duration_seconds, speaker_count,
        transcript_text, segments_json, speaker_map_json, action_items_json)
       VALUES (?, ?, 'standup.mp3', 'desktop', 300, 2, ?, '[]', ?, ?)`,
    ).run(
      id,
      owner,
      (overrides.transcript as string) ?? "Carlos: Hola. María: El presupuesto es 50k.",
      JSON.stringify({ "Speaker 0": "Carlos", "Speaker 1": "María" }),
      JSON.stringify([{ task: "Revisar presupuesto", assignee: "María", deadline: "viernes", context: "" }]),
    );
    return id;
  }

  beforeEach(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    getDbMock.mockReturnValue(db);

    const reg = await registerUser("alice@example.com", "hunter2secret");
    if (!reg.ok) throw new Error("registration failed");
    userId = reg.userId;
    cookie = `${AUTH_COOKIE}=${reg.token}`;
    recordingId = insertRecording(userId);

    llmRequests = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("ai-gateway.vercel.sh")) {
        llmRequests.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "María dijo que el presupuesto es 50k." } }] }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function post(recId: string, body: unknown, withCookie = true) {
    return postChat(
      new NextRequest(`http://localhost/api/chat/${recId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(withCookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ recordingId: recId }) },
    );
  }

  function get(recId: string, withCookie = true) {
    return getChat(
      new NextRequest(`http://localhost/api/chat/${recId}`, {
        headers: withCookie ? { cookie } : {},
      }),
      { params: Promise.resolve({ recordingId: recId }) },
    );
  }

  it("answers a question grounded in the transcript and persists both messages", async () => {
    const res = await post(recordingId, { message: "¿Qué dijo María del presupuesto?" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toContain("50k");
    expect(body.messageId).toBeTruthy();

    // the LLM saw the meeting content
    const systemPrompt = llmRequests[0].messages[0].content;
    expect(systemPrompt).toContain("presupuesto es 50k");
    expect(systemPrompt).toContain("María");
    expect(systemPrompt).toContain("Revisar presupuesto");

    // both sides of the exchange are persisted, in order
    const history = await (await get(recordingId)).json();
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0]).toMatchObject({ role: "user", content: "¿Qué dijo María del presupuesto?" });
    expect(history.messages[1]).toMatchObject({ role: "assistant" });
  });

  it("feeds prior conversation history to the LLM on follow-ups", async () => {
    await post(recordingId, { message: "Primera pregunta" });
    await post(recordingId, { message: "¿Y algo más?" });

    const second = llmRequests[1];
    const roles = second.messages.map((m) => m.role);
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(second.messages[1].content).toBe("Primera pregunta");
  });

  it("uses the user's configured chatbot model", async () => {
    db.prepare(
      "INSERT INTO user_settings (user_id, deepgram_model, actions_llm_model, chatbot_llm_model) VALUES (?, 'nova-3', 'deepseek/deepseek-r1', 'openai/gpt-4o')",
    ).run(userId);

    await post(recordingId, { message: "hola" });
    expect(llmRequests[0].model).toBe("openai/gpt-4o");
  });

  it("returns 404 for a recording the user doesn't own", async () => {
    const other = await registerUser("bob@example.com", "hunter2secret");
    if (!other.ok) throw new Error("registration failed");
    const otherRec = insertRecording(other.userId);

    expect((await post(otherRec, { message: "hola" })).status).toBe(404);
    expect((await get(otherRec)).status).toBe(404);
  });

  it("returns 400 when the message field is missing or empty", async () => {
    expect((await post(recordingId, {})).status).toBe(400);
    expect((await post(recordingId, { message: "   " })).status).toBe(400);
  });

  it("still responds for a recording with an empty transcript", async () => {
    const emptyRec = insertRecording(userId, { transcript: "" });
    const res = await post(emptyRec, { message: "¿De qué trató la reunión?" });
    expect(res.status).toBe(200);
    expect(llmRequests[0].messages[0].content).toContain("no transcript");
  });

  it("requires authentication", async () => {
    expect((await post(recordingId, { message: "hola" }, false)).status).toBe(401);
    expect((await get(recordingId, false)).status).toBe(401);
  });
});
