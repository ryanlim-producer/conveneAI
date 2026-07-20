import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withOrgAuth, type OrgMemberContext, type OrgOwnerContext } from "@/lib/with-org-auth";

// GET: recordings the current viewer has an active chat thread in, most recent first
async function handleGetRecentChats(
  _req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string; memberId?: string; userId?: string } },
): Promise<NextResponse> {
  const db = getDb();
  const orgId = ctx.orgContext.orgId;
  const isOwner = ctx.orgContext.type === "owner";
  const identityId = isOwner
    ? (ctx.orgContext as OrgOwnerContext).userId
    : (ctx.orgContext as OrgMemberContext).memberId;

  const folderIds = (
    db
      .prepare("SELECT group_id FROM org_folder_links WHERE organization_id = ?")
      .all(orgId) as { group_id: string }[]
  ).map((r) => r.group_id);

  if (folderIds.length === 0) {
    return NextResponse.json({ chats: [] });
  }

  const identityFilter = isOwner ? "cm.user_id = ? AND cm.member_id IS NULL" : "cm.member_id = ?";
  const placeholders = folderIds.map(() => "?").join(",");

  const rows = db
    .prepare(
      `SELECT r.id AS recording_id, r.filename, r.created_at AS recording_created_at,
              (SELECT cm2.content FROM chat_messages cm2
               WHERE cm2.recording_id = r.id AND ${identityFilter.replace("cm.", "cm2.")}
               ORDER BY cm2.created_at DESC, cm2.rowid DESC LIMIT 1) AS last_message,
              MAX(cm.created_at) AS last_chat_at
       FROM chat_messages cm
       JOIN recordings r ON r.id = cm.recording_id
       WHERE ${identityFilter} AND r.group_id IN (${placeholders})
       GROUP BY r.id
       ORDER BY last_chat_at DESC`,
    )
    .all(identityId, identityId, ...folderIds) as {
    recording_id: string;
    filename: string;
    recording_created_at: string;
    last_message: string | null;
    last_chat_at: string;
  }[];

  return NextResponse.json({
    chats: rows.map((r) => ({
      recordingId: r.recording_id,
      recordingFilename: r.filename,
      recordingCreatedAt: r.recording_created_at,
      lastMessage: r.last_message ?? "",
      lastChatAt: r.last_chat_at,
    })),
  });
}

export const GET = withOrgAuth(handleGetRecentChats);
export { handleGetRecentChats };
