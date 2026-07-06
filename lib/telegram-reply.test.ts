import { describe, it, expect } from "vitest";
import { formatTranscriptionReply } from "@/lib/telegram-reply";
import type { ActionItem } from "@/lib/action-extractor";

describe("formatTranscriptionReply", () => {
  it("formats action items into a Telegram message", () => {
    const actionItems: ActionItem[] = [
      { task: "Review Q3 budget", assignee: "Carlos", deadline: "Friday", context: "Budget planning" },
      { task: "Update deck", assignee: "María", deadline: "Wednesday", context: "" },
    ];

    const result = formatTranscriptionReply(actionItems, 120, 2, "rec-123");

    expect(result.text).toContain("2 min");
    expect(result.text).toContain("2 speakers");
    expect(result.text).toContain("Review Q3 budget");
    expect(result.text).toContain("Carlos");
    expect(result.text).toContain("Friday");
    expect(result.text).toContain("Update deck");
    expect(result.text).toContain("María");
  });

  it("handles missing assignee and deadline gracefully", () => {
    const actionItems: ActionItem[] = [
      { task: "Call client", assignee: "", deadline: "", context: "" },
    ];

    const result = formatTranscriptionReply(actionItems, 10, 1, "rec-456");

    expect(result.text).toContain("Call client");
    expect(result.text).toContain("Unassigned");
  });

  it("includes web UI link in the response", () => {
    const result = formatTranscriptionReply([], 30, 3, "rec-789");

    expect(result.text).toContain("rec-789");
  });

  it("includes inline keyboard with copy button", () => {
    const result = formatTranscriptionReply(
      [{ task: "Test", assignee: "", deadline: "", context: "" }],
      10,
      1,
      "rec-abc",
    );

    expect(result.replyMarkup).toBeDefined();
    expect(result.replyMarkup.inline_keyboard).toBeDefined();
    expect(result.replyMarkup.inline_keyboard[0]).toBeDefined();
    // Should have a copy button
    const buttons = result.replyMarkup.inline_keyboard[0];
    const copyButton = buttons.find((b: any) => b.text?.includes("Copy"));
    expect(copyButton).toBeDefined();
  });
});
