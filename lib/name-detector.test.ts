import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectSpeakerNames } from "@/lib/name-detector";

// Mock the LLM client
vi.mock("@/lib/llm-client", () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from "@/lib/llm-client";

describe("detectSpeakerNames", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns name mapping when LLM detects names from conversation", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce(
      JSON.stringify({ "Speaker 0": "María", "Speaker 1": "Carlos" }),
    );

    const segments = [
      { speaker: 0, text: "gracias", start: 0, end: 1, confidence: 0.99 },
      { speaker: 1, text: "de nada", start: 1, end: 2, confidence: 0.99 },
    ];

    const result = await detectSpeakerNames("test-session", segments);

    expect(result).toEqual({
      "Speaker 0": "María",
      "Speaker 1": "Carlos",
    });
  });

  it("includes transcript context in the LLM prompt", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce("{}");

    const segments = [
      { speaker: 0, text: "Hola María", start: 0, end: 1, confidence: 0.99 },
      { speaker: 1, text: "Hola Carlos", start: 1, end: 2, confidence: 0.99 },
    ];

    await detectSpeakerNames("test-session", segments);

    const promptArg = vi.mocked(callLLM).mock.calls[0][1].messages[0].content;
    expect(promptArg).toContain("Speaker 0");
    expect(promptArg).toContain("Hola María");
    expect(promptArg).toContain("Speaker 1");
    expect(promptArg).toContain("Hola Carlos");
  });

  it("falls back to Speaker N labels when LLM returns empty object", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce("{}");

    const segments = [
      { speaker: 0, text: "hola", start: 0, end: 1, confidence: 0.99 },
      { speaker: 2, text: "mundo", start: 1, end: 2, confidence: 0.99 },
    ];

    const result = await detectSpeakerNames("test-session", segments);

    // Should use numeric fallback
    expect(result["Speaker 0"]).toBe("Speaker 0");
    expect(result["Speaker 2"]).toBe("Speaker 2");
  });

  it("falls back when LLM returns malformed JSON", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce("not valid json {{{");

    const segments = [
      { speaker: 0, text: "hola", start: 0, end: 1, confidence: 0.99 },
    ];

    const result = await detectSpeakerNames("test-session", segments);

    expect(result["Speaker 0"]).toBe("Speaker 0");
  });

  it("uses low temperature for deterministic output", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce("{}");

    await detectSpeakerNames("test-session", [
      { speaker: 0, text: "hola", start: 0, end: 1, confidence: 0.99 },
    ]);

    const options = vi.mocked(callLLM).mock.calls[0][1];
    expect(options.temperature).toBe(0.1);
  });
});

describe("detectSpeakerNames model selection", () => {
  it("uses the caller's chosen model", async () => {
    vi.mocked(callLLM).mockClear().mockResolvedValueOnce("{}");
    await detectSpeakerNames("user-1", [{ speaker: 0, text: "hola", start: 0, end: 1, confidence: 0.9 }], "anthropic/claude-sonnet-4-20250514");
    expect(vi.mocked(callLLM).mock.calls[0][1].model).toBe("anthropic/claude-sonnet-4-20250514");
  });
});
