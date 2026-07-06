import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getDb, newId } from "@/lib/db";
import { chatAboutMeeting, type ChatTurn } from "@/lib/chatbot";
import { getUserSettings } from "@/lib/settings";

interface RecordingRow {
  id: string;
  filename: string;
  transcript_text: string | null;
  speaker_map_json: string | null;
  action_items_json: string | null;
}

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function getRecording(userId: string, recordingId: string): RecordingRow | undefined {
  return getDb()
    .prepare(
      "SELECT id, filename, transcript_text, speaker_map_json, action_items_json FROM recordings WHERE id = ? AND user_id = ?",
    )
    .get(recordingId, userId) as RecordingRow | undefined;
}

function getHistory(recordingId: string): (ChatTurn & { id: string; createdAt: string })[] {
  const rows = getDb()
    .prepare(
      "SELECT id, role, content, created_at FROM chat_messages WHERE recording_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(recordingId) as { id: string; role: "user" | "assistant"; content: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, createdAt: r.created_at }));
}

export const GET = withAuth<{ recordingId: string }>(async (_req, { user, params }) => {
  const recording = params?.recordingId ? getRecording(user.userId, params.recordingId) : undefined;
  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }
  return NextResponse.json({ messages: getHistory(recording.id) });
});

export const POST = withAuth<{ recordingId: string }>(async (req: NextRequest, { user, params }) => {
  const recording = params?.recordingId ? getRecording(user.userId, params.recordingId) : undefined;
  if (!recording) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  let body: { message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const history = getHistory(recording.id).map(({ role, content }) => ({ role, content }));
  const settings = getUserSettings(user.userId);

  let reply: string;
  try {
    reply = await chatAboutMeeting(
      user.userId,
      {
        filename: recording.filename,
        transcriptText: recording.transcript_text ?? "",
        speakerMap: safeParse(recording.speaker_map_json, {}),
        actionItems: safeParse(recording.action_items_json, []),
      },
      history,
      message,
      settings.chatbotLlmModel,
    );
  } catch (error) {
    console.error("Chatbot LLM error:", error);
    return NextResponse.json(
      { error: "The assistant couldn't respond. Check your AI Gateway key and try again." },
      { status: 500 },
    );
  }

  const db = getDb();
  const messageId = newId();
  const insert = db.prepare(
    "INSERT INTO chat_messages (id, recording_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)",
  );
  const saveExchange = db.transaction(() => {
    insert.run(newId(), recording.id, user.userId, "user", message);
    insert.run(messageId, recording.id, user.userId, "assistant", reply);
  });
  saveExchange();

  return NextResponse.json({ reply, messageId });
});
