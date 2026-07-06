import type { ActionItem } from "@/lib/action-extractor";

interface ReplyPayload {
  text: string;
  replyMarkup: {
    inline_keyboard: Array<Array<{ text: string; callback_data?: string }>>;
  };
}

export function formatTranscriptionReply(
  actionItems: ActionItem[],
  durationSeconds: number,
  speakerCount: number,
  recordingId: string,
): ReplyPayload {
  const minutes = Math.round(durationSeconds / 60 * 10) / 10;
  const durationStr = minutes >= 1
    ? `${minutes} min`
    : `${Math.round(durationSeconds)}s`;

  let text = `✅ *Transcripción completa* — ${durationStr} — ${speakerCount} speaker${speakerCount !== 1 ? "s" : ""}`;

  if (actionItems.length > 0) {
    text += `\n\n📋 *Action Items:*`;
    for (const item of actionItems) {
      text += `\n• ${item.task}`;
      if (item.assignee) text += ` → ${item.assignee}`;
      if (item.deadline) text += ` (${item.deadline})`;
      if (!item.assignee && !item.deadline) text += ` → Unassigned`;
    }
  }

  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  text += `\n\n🔗 [View in web UI](${baseUrl}/recording/${recordingId})`;

  return {
    text,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "📋 Copy Full Transcript", callback_data: `copy:${recordingId}` }],
      ],
    },
  };
}
