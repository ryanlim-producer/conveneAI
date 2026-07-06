import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribeAudio, getBalance } from "@/lib/deepgram";

const SAMPLE_DEEPGRAM_RESPONSE = {
  metadata: { duration: 42.5, channels: 1 },
  results: {
    channels: [
      {
        alternatives: [
          {
            words: [
              { word: "hola", start: 0.5, end: 1.0, speaker: 0, confidence: 0.98, punctuated_word: "Hola" },
              { word: "mundo", start: 1.2, end: 1.8, speaker: 0, confidence: 0.95, punctuated_word: "mundo" },
              { word: "bienvenidos", start: 2.5, end: 3.2, speaker: 1, confidence: 0.97, punctuated_word: "bienvenidos" },
            ],
            transcript: "Hola mundo bienvenidos",
          },
        ],
      },
    ],
  },
};

describe("transcribeAudio", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("passes correct Deepgram options: model, language, diarize, smart_format", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_DEEPGRAM_RESPONSE), { status: 200 }),
    );

    await transcribeAudio("dg-test-key", Buffer.from("fake-mp3"), "es");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("api.deepgram.com/v1/listen");
    expect(url).toContain("model=nova-3");
    expect(url).toContain("language=es");
    expect(url).toContain("diarize=true");
    expect(url).toContain("smart_format=true");

    const options = fetchSpy.mock.calls[0][1] as any;
    expect(options.headers["Authorization"]).toBe("Token dg-test-key");
    expect(options.headers["Content-Type"]).toBe("audio/mpeg");
  });

  it("transcribes with the caller's chosen model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_DEEPGRAM_RESPONSE), { status: 200 }),
    );

    await transcribeAudio("dg-test-key", Buffer.from("fake-mp3"), "es", "nova-2-meeting");

    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toContain("model=nova-2-meeting");
  });

  it("returns structured transcript with segments and speakers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_DEEPGRAM_RESPONSE), { status: 200 }),
    );

    const result = await transcribeAudio("dg-key", Buffer.from("audio"), "en");

    expect(result.duration).toBe(42.5);
    expect(result.speakerCount).toBe(2);
    expect(result.fullTranscript).toBe("Hola mundo bienvenidos");
    expect(result.segments).toHaveLength(3);
    expect(result.segments[0]).toEqual({
      speaker: 0,
      text: "Hola",
      start: 0.5,
      end: 1.0,
      confidence: 0.98,
    });
  });

  it("detects no speech and returns empty result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          metadata: { duration: 0 },
          results: {
            channels: [{ alternatives: [{ words: [], transcript: "" }] }],
          },
        }),
        { status: 200 },
      ),
    );

    const result = await transcribeAudio("dg-key", Buffer.from("silence"));
    expect(result.fullTranscript).toBe("");
    expect(result.segments).toHaveLength(0);
  });

  it("propagates Deepgram API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }),
    );

    await expect(
      transcribeAudio("bad-key", Buffer.from("audio")),
    ).rejects.toThrow("Deepgram API error");
  });

  it("sends audio as binary body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(SAMPLE_DEEPGRAM_RESPONSE), { status: 200 }),
    );

    await transcribeAudio("dg-key", Buffer.from("binary-audio"));
    const body = (vi.spyOn(globalThis, "fetch").mock.calls[0][1] as any).body;
    expect(body).toBeInstanceOf(Uint8Array);
  });
});

const SAMPLE_PROJECTS_RESPONSE = {
  projects: [{ project_id: "proj_abc123", name: "My Project" }],
};

const SAMPLE_BALANCES_RESPONSE = {
  balances: [
    {
      balance_id: "bal_1",
      amount: 50.0,
      units: "usd",
      purchase: "credit",
    },
    {
      balance_id: "bal_2",
      amount: 25.0,
      units: "usd",
      purchase: "bonus",
    },
  ],
};

describe("getBalance", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches projects then balances with correct Authorization header", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_PROJECTS_RESPONSE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_BALANCES_RESPONSE), { status: 200 }),
      );

    await getBalance("dg-test-key");

    const firstCall = fetchSpy.mock.calls[0];
    const firstUrl = firstCall[0] as string;
    expect(firstUrl).toContain("api.deepgram.com/v1/projects");
    const firstHeaders = (firstCall[1] as any).headers;
    expect(firstHeaders["Authorization"]).toBe("Token dg-test-key");

    const secondCall = fetchSpy.mock.calls[1];
    const secondUrl = secondCall[0] as string;
    expect(secondUrl).toContain("api.deepgram.com/v1/projects/proj_abc123/balances");
    const secondHeaders = (secondCall[1] as any).headers;
    expect(secondHeaders["Authorization"]).toBe("Token dg-test-key");
  });

  it("returns structured BalanceResult with amount and units", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_PROJECTS_RESPONSE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_BALANCES_RESPONSE), { status: 200 }),
      );

    const result = await getBalance("dg-key");

    expect(result.amount).toBe(75.0); // 50 + 25
    expect(result.units).toBe("usd");
  });

  it("propagates Deepgram API error from projects call", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 }),
    );

    await expect(getBalance("bad-key")).rejects.toThrow("Deepgram API error");
  });

  it("propagates Deepgram API error from balances call", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_PROJECTS_RESPONSE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Server error" }), { status: 500 }),
      );

    await expect(getBalance("dg-key")).rejects.toThrow("Deepgram API error");
  });

  it("throws error when projects list is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ projects: [] }), { status: 200 }),
    );

    await expect(getBalance("dg-key")).rejects.toThrow("no projects");
  });

  it("returns zero balance when balances array is empty", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(SAMPLE_PROJECTS_RESPONSE), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ balances: [] }), { status: 200 }),
      );

    const result = await getBalance("dg-key");

    expect(result.amount).toBe(0);
    expect(result.units).toBe("usd");
  });

  it("handles network error gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new TypeError("fetch failed"),
    );

    await expect(getBalance("dg-key")).rejects.toThrow("Deepgram API error");
  });
});
