import { callLLM } from "./llm-client";
import type { ActionItem } from "./action-extractor";

// ~20K tokens at ~4 chars/token; longer transcripts are cut to the tail.
const MAX_TRANSCRIPT_CHARS = 80_000;

export interface MeetingContext {
  filename: string;
  transcriptText: string;
  speakerMap: Record<string, string>;
  actionItems: ActionItem[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export function buildSystemPrompt(meeting: MeetingContext): string {
  const speakerLines = Object.entries(meeting.speakerMap)
    .map(([id, name]) => `- ${id}: ${name}`)
    .join("\n");

  const actionLines = meeting.actionItems.length
    ? meeting.actionItems
        .map(
          (a) =>
            `- ${a.task}${a.assignee ? ` (assignee: ${a.assignee}` : ""}${
              a.assignee && a.deadline ? `, deadline: ${a.deadline})` : a.assignee ? ")" : ""
            }`,
        )
        .join("\n")
    : "None detected.";

  let transcript = meeting.transcriptText?.trim() ?? "";
  let truncationNote = "";
  if (!transcript) {
    transcript = "(no transcript available for this recording)";
  } else if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    transcript = transcript.slice(-MAX_TRANSCRIPT_CHARS);
    truncationNote =
      "\nNote: the transcript was too long to include fully; only the final portion is shown.";
  }

  return `You are a meeting assistant answering questions about one specific recorded meeting ("${meeting.filename}").

Ground every answer strictly in the meeting content below. When the user asks about what someone said, attribute statements to speakers by name. If the answer is not in the transcript, say so — never invent content. Answer in the language the user writes in.

Speakers:
${speakerLines || "- (unknown)"}

Action items:
${actionLines}

Transcript:${truncationNote}
${transcript}`;
}

export async function chatAboutMeeting(
  userId: string,
  meeting: MeetingContext,
  history: ChatTurn[],
  userMessage: string,
  model: string,
): Promise<string> {
  return callLLM(userId, {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt(meeting) },
      ...history,
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: 2000,
  });
}
