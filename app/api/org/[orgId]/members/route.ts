import { NextRequest, NextResponse } from "next/server";
import { getDb, newId } from "@/lib/db";
import { withOrgAuth } from "@/lib/with-org-auth";
import { destroyOrgSession } from "@/lib/org-auth";

function requireOwner(ctx: { orgContext: { type: string } }): NextResponse | null {
  if (ctx.orgContext.type !== "owner") {
    return NextResponse.json({ error: "Only the owner can manage members." }, { status: 403 });
  }
  return null;
}

// GET: list members with active status
async function handleGetMembers(
  _req: NextRequest,
  ctx: { orgContext: { orgId: string } },
): Promise<NextResponse> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.id, m.name,
              (SELECT COUNT(*) > 0 FROM org_member_sessions s
               WHERE s.member_id = m.id AND s.expires_at > datetime('now')) AS active
       FROM org_members m
       WHERE m.organization_id = ?
       ORDER BY m.name COLLATE NOCASE ASC`,
    )
    .all(ctx.orgContext.orgId) as { id: string; name: string; active: number }[];

  return NextResponse.json({
    members: rows.map((r) => ({ id: r.id, name: r.name, active: Boolean(r.active) })),
  });
}

// POST: add member
async function handleAddMember(
  req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string } },
): Promise<NextResponse> {
  const authError = requireOwner(ctx);
  if (authError) return authError;

  let body: { name?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Member name cannot be empty." }, { status: 400 });
  }

  const db = getDb();
  const id = newId();
  const name = body.name.trim();

  db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, ?)").run(
    id, ctx.orgContext.orgId, name,
  );

  return NextResponse.json({ id, name }, { status: 201 });
}

// DELETE: remove member — deletes chat messages + active session
async function handleRemoveMember(
  req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string } },
): Promise<NextResponse> {
  const authError = requireOwner(ctx);
  if (authError) return authError;

  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "memberId query param is required." }, { status: 400 });
  }

  const db = getDb();

  // Verify member belongs to this org
  const member = db
    .prepare("SELECT id FROM org_members WHERE id = ? AND organization_id = ?")
    .get(memberId, ctx.orgContext.orgId) as { id: string } | undefined;
  if (!member) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  // Destroy active sessions first
  const sessions = db
    .prepare("SELECT token FROM org_member_sessions WHERE member_id = ?")
    .all(memberId) as { token: string }[];
  for (const s of sessions) destroyOrgSession(s.token);

  // Count chat messages before deletion
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE member_id = ?")
    .get(memberId) as { count: number };

  // Delete member (cascade deletes sessions and chat messages)
  db.prepare("DELETE FROM org_members WHERE id = ?").run(memberId);

  return NextResponse.json({ removed: true, deletedChatCount: count });
}

export const GET = withOrgAuth(handleGetMembers);
export const POST = withOrgAuth(handleAddMember);
export const DELETE = withOrgAuth(handleRemoveMember);

export { handleGetMembers, handleAddMember, handleRemoveMember };
