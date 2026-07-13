import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import type { SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

function getGroup(
  userId: string,
  groupId: string,
): { id: string; name: string } | undefined {
  const db = getDb();
  return db
    .prepare("SELECT id, name FROM groups WHERE id = ? AND user_id = ?")
    .get(groupId, userId) as { id: string; name: string } | undefined;
}

async function handleRenameGroup(
  req: NextRequest,
  ctx: { user: SessionUser; params?: { id: string } },
): Promise<NextResponse> {
  const id = ctx.params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing group id." }, { status: 400 });
  }

  const group = getGroup(ctx.user.userId, id);
  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Group name cannot be empty." }, { status: 400 });
  }

  const name = body.name.trim();

  // Check for duplicate (case-insensitive, excluding self)
  const existing = getDb()
    .prepare("SELECT id FROM groups WHERE user_id = ? AND name = ? COLLATE NOCASE AND id != ?")
    .get(ctx.user.userId, name, id) as { id: string } | undefined;

  if (existing) {
    return NextResponse.json(
      { error: "A group with this name already exists." },
      { status: 409 },
    );
  }

  getDb().prepare("UPDATE groups SET name = ? WHERE id = ?").run(name, id);

  return NextResponse.json({ id, name });
}

async function handleDeleteGroup(
  _req: NextRequest,
  ctx: { user: SessionUser; params?: { id: string } },
): Promise<NextResponse> {
  const id = ctx.params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing group id." }, { status: 400 });
  }

  const group = getGroup(ctx.user.userId, id);
  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  const db = getDb();

  // Count recordings that will be ungrouped
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM recordings WHERE group_id = ? AND user_id = ?")
    .get(id, ctx.user.userId) as { count: number };

  // Ungroup all recordings in this group
  db.prepare(
    "UPDATE recordings SET group_id = NULL, group_name = NULL WHERE group_id = ? AND user_id = ?",
  ).run(id, ctx.user.userId);

  // Delete the group
  db.prepare("DELETE FROM groups WHERE id = ?").run(id);

  return NextResponse.json({ deleted: true, id, ungroupedCount: count });
}

export const PATCH = withAuth<{ id: string }>(handleRenameGroup);
export const DELETE = withAuth<{ id: string }>(handleDeleteGroup);

// Exported for testing
export { handleRenameGroup, handleDeleteGroup };
