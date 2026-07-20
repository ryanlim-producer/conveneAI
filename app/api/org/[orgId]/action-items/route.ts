import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withOrgAuth, type OrgOwnerContext } from "@/lib/with-org-auth";
import type { ActionItem } from "@/lib/action-extractor";

// GET: aggregated action items across all shared folders
async function handleGetActionItems(
  _req: NextRequest,
  ctx: { orgContext: { orgId: string } },
): Promise<NextResponse> {
  const db = getDb();
  const orgId = ctx.orgContext.orgId;

  // Get shared folder IDs for this org
  const folderIds = (
    db
      .prepare("SELECT group_id FROM org_folder_links WHERE organization_id = ?")
      .all(orgId) as { group_id: string }[]
  ).map((r) => r.group_id);

  if (folderIds.length === 0) {
    return NextResponse.json({ folders: [] });
  }

  // Get folder names
  const folderMap = new Map<string, string>();
  for (const fid of folderIds) {
    const f = db.prepare("SELECT name FROM groups WHERE id = ?").get(fid) as { name: string } | undefined;
    if (f) folderMap.set(fid, f.name);
  }

  // Get recordings from shared folders
  const recordings = db
    .prepare(
      `SELECT id, filename, group_id, action_items_json, created_at
       FROM recordings
       WHERE group_id IN (${folderIds.map(() => "?").join(",")})
       ORDER BY created_at DESC`,
    )
    .all(...folderIds) as {
    id: string;
    filename: string;
    group_id: string;
    action_items_json: string | null;
    created_at: string;
  }[];

  // Group action items by folder
  const folderItems = new Map<string, { folderId: string; folderName: string; items: { task: string; assignee: string; deadline: string; context: string; completed: boolean; recordingId: string; recordingFilename: string; recordingCreatedAt: string; itemIndex: number }[] }>();

  for (const fid of folderIds) {
    folderItems.set(fid, {
      folderId: fid,
      folderName: folderMap.get(fid) || fid,
      items: [],
    });
  }

  for (const rec of recordings) {
    const folder = folderItems.get(rec.group_id);
    if (!folder) continue;

    try {
      const items = JSON.parse(rec.action_items_json ?? "[]");
      if (Array.isArray(items)) {
        items.forEach((item, itemIndex) => {
          if (item.task) {
            folder.items.push({
              task: item.task || "",
              assignee: item.assignee || "",
              deadline: item.deadline || "",
              context: item.context || "",
              completed: Boolean(item.completed),
              recordingId: rec.id,
              recordingFilename: rec.filename,
              recordingCreatedAt: rec.created_at,
              itemIndex,
            });
          }
        });
      }
    } catch { /* skip malformed JSON */ }
  }

  return NextResponse.json({
    folders: [...folderItems.values()].filter((f) => f.items.length > 0),
  });
}

export const GET = withOrgAuth(handleGetActionItems);
export { handleGetActionItems };

// PATCH: update action items for a recording (owner only)
async function handleUpdateActionItems(
  req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string; userId?: string } },
): Promise<NextResponse> {
  if (ctx.orgContext.type !== "owner") {
    return NextResponse.json({ error: "Only the owner can edit action items." }, { status: 403 });
  }

  let body: { recordingId?: unknown; actionItems?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.recordingId !== "string" || !body.recordingId.trim()) {
    return NextResponse.json({ error: "recordingId is required." }, { status: 400 });
  }

  if (!Array.isArray(body.actionItems)) {
    return NextResponse.json({ error: "actionItems must be an array." }, { status: 400 });
  }

  const items: ActionItem[] = [];
  for (const raw of body.actionItems) {
    if (typeof raw !== "object" || raw === null || typeof (raw as ActionItem).task !== "string" ||
        !(raw as ActionItem).task.trim()) {
      return NextResponse.json(
        { error: "Every action item needs a non-empty task." },
        { status: 400 },
      );
    }
    const item = raw as Partial<ActionItem>;
    items.push({
      task: item.task!.trim(),
      assignee: (item.assignee ?? "").toString().trim(),
      deadline: (item.deadline ?? "").toString().trim(),
      context: (item.context ?? "").toString().trim(),
    });
  }

  const db = getDb();
  const orgId = ctx.orgContext.orgId;

  // Verify recording belongs to a folder shared with this org
  const folderIds = (
    db
      .prepare("SELECT group_id FROM org_folder_links WHERE organization_id = ?")
      .all(orgId) as { group_id: string }[]
  ).map((r) => r.group_id);

  if (folderIds.length === 0) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const placeholders = folderIds.map(() => "?").join(",");
  const rec = db
    .prepare(
      `SELECT id FROM recordings WHERE id = ? AND group_id IN (${placeholders})`,
    )
    .get(body.recordingId.trim(), ...folderIds) as { id: string } | undefined;

  if (!rec) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
    .run(JSON.stringify(items), body.recordingId.trim());

  return NextResponse.json({ ok: true });
}

export const PATCH = withOrgAuth(handleUpdateActionItems);
export { handleUpdateActionItems };
