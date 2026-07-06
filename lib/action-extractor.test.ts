import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractActionItems } from "@/lib/action-extractor";

vi.mock("@/lib/llm-client", () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from "@/lib/llm-client";

describe("extractActionItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts action items from transcript with speaker names", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce(
      JSON.stringify([
        { task: "Review Q3 budget", assignee: "Carlos", deadline: "Friday", context: "Budget meeting follow-up" },
        { task: "Update deck", assignee: "María", deadline: "Wednesday", context: "" },
      ]),
    );

    const transcript = "María: Necesitamos revisar el presupuesto. Carlos: Yo me encargo. Lo tengo para el viernes.";
    const speakerMap = { "Speaker 0": "María", "Speaker 1": "Carlos" };

    const result = await extractActionItems("test-session", transcript, speakerMap);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      task: "Review Q3 budget",
      assignee: "Carlos",
      deadline: "Friday",
      context: "Budget meeting follow-up",
    });
    expect(result[1].task).toBe("Update deck");
  });

  it("includes speaker names in the prompt for context", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce("[]");

    const transcript = "Some transcript text";
    const speakerMap = { "Speaker 0": "María", "Speaker 1": "Carlos" };

    await extractActionItems("test-session", transcript, speakerMap);

    const promptContent = vi.mocked(callLLM).mock.calls[0][1].messages[0].content;
    expect(promptContent).toContain("María");
    expect(promptContent).toContain("Carlos");
    expect(promptContent).toContain("Some transcript text");
  });

  it("returns empty array when no action items found", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce("[]");

    const result = await extractActionItems("test-session", "Just casual chat", {});

    expect(result).toEqual([]);
  });

  it("handles malformed JSON gracefully", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce("this is not JSON at all ... broken response");

    const result = await extractActionItems("test-session", "Some text", {});

    expect(result).toEqual([]);
  });

  it("extracts JSON from markdown-wrapped response", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce(
      '```json\n[{"task": "Call client", "assignee": "Ana", "deadline": "tomorrow", "context": "Urgent"}]\n```',
    );

    const result = await extractActionItems("test-session", "Ana: Voy a llamar al cliente mañana", {
      "Speaker 0": "Ana",
    });

    expect(result).toHaveLength(1);
    expect(result[0].task).toBe("Call client");
    expect(result[0].assignee).toBe("Ana");
  });

  it("filters out items missing the task field", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce(
      JSON.stringify([
        { task: "Valid task", assignee: "X", deadline: "", context: "" },
        { assignee: "Y", deadline: "tomorrow", context: "" }, // no task
        { task: "Another task", assignee: "", deadline: "", context: "" },
      ]),
    );

    const result = await extractActionItems("test-session", "text", {});

    expect(result).toHaveLength(2);
    expect(result[0].task).toBe("Valid task");
    expect(result[1].task).toBe("Another task");
  });

  it("uses low temperature for consistent output", async () => {
    vi.mocked(callLLM).mockResolvedValueOnce("[]");

    await extractActionItems("test-session", "text", {});

    const options = vi.mocked(callLLM).mock.calls[0][1];
    expect(options.temperature).toBe(0.1);
  });
});

describe("extractActionItems model selection", () => {
  it("uses the caller's chosen model", async () => {
    vi.mocked(callLLM).mockClear().mockResolvedValueOnce("[]");
    await extractActionItems("user-1", "transcript", {}, "openai/gpt-4o");
    expect(vi.mocked(callLLM).mock.calls[0][1].model).toBe("openai/gpt-4o");
  });

  it("defaults to deepseek-r1 when no model is given", async () => {
    vi.mocked(callLLM).mockClear().mockResolvedValueOnce("[]");
    await extractActionItems("user-1", "transcript", {});
    expect(vi.mocked(callLLM).mock.calls[0][1].model).toBe("deepseek/deepseek-r1");
  });
});
