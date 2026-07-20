import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withOrgAuth } from "@/lib/with-org-auth";
import type { ActionItem } from "@/lib/action-extractor";

// PATCH: toggle an action item's completed state (any org viewer — owner or member)
async function handleToggleActionItem(
  req: NextRequest,
  ctx: { orgContext: { orgId: string } },
): Promise<NextResponse> {
  let body: { recordingId?: unknown; itemIndex?: unknown; completed?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.recordingId !== "string" || !body.recordingId.trim()) {
    return NextResponse.json({ error: "recordingId is required." }, { status: 400 });
  }
  if (typeof body.itemIndex !== "number" || !Number.isInteger(body.itemIndex) || body.itemIndex < 0) {
    return NextResponse.json({ error: "itemIndex must be a non-negative integer." }, { status: 400 });
  }
  if (typeof body.completed !== "boolean") {
    return NextResponse.json({ error: "completed must be a boolean." }, { status: 400 });
  }

  const db = getDb();
  const orgId = ctx.orgContext.orgId;

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
      `SELECT id, action_items_json FROM recordings WHERE id = ? AND group_id IN (${placeholders})`,
    )
    .get(body.recordingId.trim(), ...folderIds) as { id: string; action_items_json: string | null } | undefined;

  if (!rec) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  let items: ActionItem[] = [];
  try {
    const parsed = JSON.parse(rec.action_items_json ?? "[]");
    if (Array.isArray(parsed)) items = parsed;
  } catch { /* malformed JSON treated as empty */ }

  if (body.itemIndex >= items.length) {
    return NextResponse.json({ error: "itemIndex out of range." }, { status: 400 });
  }

  items[body.itemIndex] = { ...items[body.itemIndex], completed: body.completed };

  db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
    .run(JSON.stringify(items), body.recordingId.trim());

  return NextResponse.json({ ok: true });
}

export const PATCH = withOrgAuth(handleToggleActionItem);
export { handleToggleActionItem };
