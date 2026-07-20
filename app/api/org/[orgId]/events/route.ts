import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { withOrgAuth } from "@/lib/with-org-auth";
import { sseResponse } from "@/lib/sse";

export function getOrgSnapshot(orgId: string) {
  const db = getDb();

  // Snapshot: shared folders with their actual recording IDs (not just a
  // count), so moving a recording between two shared folders — a net-zero
  // count change — still shows up as a diff and triggers a client refresh.
  const folderIds = (
    db
      .prepare("SELECT group_id FROM org_folder_links WHERE organization_id = ?")
      .all(orgId) as { group_id: string }[]
  ).map((r) => r.group_id);

  const folders = folderIds.map((groupId) => {
    // Include each recording's action_items_json so any add/edit/toggle/delete
    // of an action item changes the snapshot and triggers an SSE update —
    // not just recording membership changes.
    const recordings = db
      .prepare("SELECT id, action_items_json FROM recordings WHERE group_id = ? ORDER BY id")
      .all(groupId) as { id: string; action_items_json: string | null }[];
    return {
      id: groupId,
      recordingIds: recordings.map((r) => r.id),
      actionItemsFingerprint: recordings.map((r) => r.action_items_json ?? "[]"),
    };
  });

  // Active member IDs — used to detect when current user is kicked
  // (either removed by owner or session destroyed by another claimant)
  const activeMemberRows = db
    .prepare(
      `SELECT m.id FROM org_members m
       INNER JOIN org_member_sessions s ON s.member_id = m.id
       WHERE m.organization_id = ? AND s.expires_at > datetime('now')`,
    )
    .all(orgId) as { id: string }[];

  return {
    folders,
    memberIds: activeMemberRows.map((m) => m.id),
  };
}

export const GET = withOrgAuth(async (req: NextRequest, { orgContext }) => {
  const orgId = orgContext.orgId;
  return sseResponse(() => getOrgSnapshot(orgId));
});
