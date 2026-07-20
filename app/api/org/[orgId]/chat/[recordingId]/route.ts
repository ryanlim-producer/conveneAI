import { NextRequest, NextResponse } from "next/server";
import { getDb, newId } from "@/lib/db";
import { withOrgAuth, type OrgMemberContext, type OrgOwnerContext } from "@/lib/with-org-auth";
import { chatAboutMeeting, type ChatTurn } from "@/lib/chatbot";

function resolveIdentity(ctx: {
  orgContext: { type: string; memberId?: string; userId?: string };
}): { isOwner: boolean; memberId?: string; userId?: string } {
  if (ctx.orgContext.type === "member") {
    return { isOwner: false, memberId: (ctx.orgContext as OrgMemberContext).memberId };
  }
  return { isOwner: true, userId: (ctx.orgContext as OrgOwnerContext).userId };
}

function getRecording(recordingId: string, groupIds: string[]): {
  id: string; filename: string; transcript_text: string | null;
  speaker_map_json: string | null; action_items_json: string | null; user_id: string;
} | undefined {
  if (groupIds.length === 0) return undefined;
  const placeholders = groupIds.map(() => "?").join(",");
  return getDb()
    .prepare(
      `SELECT id, filename, transcript_text, speaker_map_json, action_items_json, user_id
       FROM recordings WHERE id = ? AND group_id IN (${placeholders})`,
    )
    .get(recordingId, ...groupIds) as ReturnType<typeof getRecording>;
}

function getChatHistory(recordingId: string, identity: ReturnType<typeof resolveIdentity>): ChatTurn[] {
  const db = getDb();
  let rows: { role: "user" | "assistant"; content: string }[];
  if (identity.isOwner) {
    rows = db
      .prepare("SELECT role, content FROM chat_messages WHERE recording_id = ? AND user_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(recordingId, identity.userId) as { role: "user" | "assistant"; content: string }[];
  } else {
    rows = db
      .prepare("SELECT role, content FROM chat_messages WHERE recording_id = ? AND member_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(recordingId, identity.memberId) as { role: "user" | "assistant"; content: string }[];
  }
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

// GET: chat history
async function handleGetChat(
  _req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string; memberId?: string; userId?: string } },
): Promise<NextResponse> {
  const identity = resolveIdentity(ctx);
  const orgId = ctx.orgContext.orgId;

  const folderIds = (getDb()
    .prepare("SELECT group_id FROM org_folder_links WHERE organization_id = ?")
    .all(orgId) as { group_id: string }[]).map((r) => r.group_id);

  const recordingId = (ctx as { params?: { recordingId: string } }).params?.recordingId;
  if (!recordingId) return NextResponse.json({ error: "Missing recordingId." }, { status: 400 });

  const rec = getRecording(recordingId, folderIds);
  if (!rec) return NextResponse.json({ error: "Recording not found." }, { status: 404 });

  return NextResponse.json({ messages: getChatHistory(recordingId, identity) });
}

// POST: send message
async function handlePostChat(
  req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string; memberId?: string; userId?: string }; params?: { recordingId: string } },
): Promise<NextResponse> {
  const identity = resolveIdentity(ctx);
  const orgId = ctx.orgContext.orgId;

  const folderIds = (getDb()
    .prepare("SELECT group_id FROM org_folder_links WHERE organization_id = ?")
    .all(orgId) as { group_id: string }[]).map((r) => r.group_id);

  const recordingId = ctx.params?.recordingId;
  if (!recordingId) return NextResponse.json({ error: "Missing recordingId." }, { status: 400 });

  const recording = getRecording(recordingId, folderIds);
  if (!recording) return NextResponse.json({ error: "Recording not found." }, { status: 404 });

  let body: { message?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "Message is required." }, { status: 400 });

  const history = getChatHistory(recordingId, identity);

  function safeParse<T>(json: string | null, fallback: T): T {
    if (!json) return fallback;
    try { return JSON.parse(json) as T; } catch { return fallback; }
  }

  let reply: string;
  try {
    reply = await chatAboutMeeting(
      identity.userId || identity.memberId || "org-user",
      {
        filename: recording.filename,
        transcriptText: recording.transcript_text ?? "",
        speakerMap: safeParse(recording.speaker_map_json, {}),
        actionItems: safeParse(recording.action_items_json, []),
      },
      history,
      message,
      "deepseek/deepseek-r1", // default model for org chat
    );
  } catch (error) {
    console.error("Org chat LLM error:", error);
    return NextResponse.json({ error: "The assistant couldn't respond." }, { status: 500 });
  }

  const db = getDb();
  const messageId = newId();
  const insert = db.prepare(
    "INSERT INTO chat_messages (id, recording_id, user_id, member_id, role, content) VALUES (?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    insert.run(newId(), recordingId, identity.userId || null, identity.memberId || null, "user", message);
    insert.run(messageId, recordingId, identity.userId || null, identity.memberId || null, "assistant", reply);
  })();

  return NextResponse.json({ reply, messageId });
}

async function handler(req: NextRequest, ctx: unknown) {
  if (req.method === "POST") return handlePostChat(req, ctx as Parameters<typeof handlePostChat>[1]);
  return handleGetChat(req, ctx as Parameters<typeof handleGetChat>[1]);
}

export const GET = withOrgAuth(handleGetChat);
export const POST = withOrgAuth(handlePostChat);
export { handleGetChat, handlePostChat };
