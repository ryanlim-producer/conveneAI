import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import type { SessionUser } from "@/lib/auth";
import { getDb, newId } from "@/lib/db";

async function handleCreateGroup(
  req: NextRequest,
  ctx: { user: SessionUser },
): Promise<NextResponse> {
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
  const db = getDb();

  const existing = db
    .prepare("SELECT id FROM groups WHERE user_id = ? AND name = ? COLLATE NOCASE")
    .get(ctx.user.userId, name) as { id: string } | undefined;

  if (existing) {
    return NextResponse.json(
      { error: "A group with this name already exists." },
      { status: 409 },
    );
  }

  const id = newId();
  db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, ?)").run(
    id,
    ctx.user.userId,
    name,
  );

  const createdAt = (
    db.prepare("SELECT created_at FROM groups WHERE id = ?").get(id) as { created_at: string }
  ).created_at;

  return NextResponse.json({ id, name, createdAt }, { status: 201 });
}

async function handleListGroups(
  _req: NextRequest,
  ctx: { user: SessionUser },
): Promise<NextResponse> {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.created_at,
              (SELECT COUNT(*) FROM recordings r WHERE r.group_id = g.id AND r.user_id = g.user_id) AS recording_count
       FROM groups g
       WHERE g.user_id = ?
       ORDER BY g.name COLLATE NOCASE ASC`,
    )
    .all(ctx.user.userId) as { id: string; name: string; created_at: string; recording_count: number }[];

  const groups = rows.map((row) => ({
    id: row.id,
    name: row.name,
    recordingCount: row.recording_count,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ groups });
}

export const POST = withAuth(handleCreateGroup);
export const GET = withAuth(handleListGroups);

// Exported for testing
export { handleCreateGroup, handleListGroups };
