import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createOrgSession, ORG_AUTH_COOKIE } from "@/lib/org-auth";
import bcrypt from "bcryptjs";

export const ORG_AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
  path: "/",
};

async function handleOrgAuth(req: NextRequest): Promise<NextResponse> {
  let body: {
    slug?: unknown;
    password?: unknown;
    claimMemberId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.slug !== "string" || !body.slug.trim()) {
    return NextResponse.json({ error: "Organization slug is required." }, { status: 400 });
  }

  const slug = body.slug.trim();
  const db = getDb();

  const org = db
    .prepare("SELECT id, password_hash FROM organizations WHERE slug = ?")
    .get(slug) as { id: string; password_hash: string } | undefined;

  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  // Password check is always required
  if (typeof body.password !== "string" || !body.password.trim()) {
    return NextResponse.json({ error: "Password is required." }, { status: 400 });
  }

  const passwordMatch = await bcrypt.compare(body.password.trim(), org.password_hash);
  if (!passwordMatch) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  // If claiming a member
  if (typeof body.claimMemberId === "string" && body.claimMemberId.trim()) {
    const memberId = body.claimMemberId.trim();

    // Verify member exists in this org
    const member = db
      .prepare("SELECT id, name FROM org_members WHERE id = ? AND organization_id = ?")
      .get(memberId, org.id) as { id: string; name: string } | undefined;

    if (!member) {
      return NextResponse.json(
        { error: "Member not found in this organization." },
        { status: 404 },
      );
    }

    // Check for active session — destroy it if exists, then create new
    const claimResult = db.transaction(() => {
      // Destroy any existing active sessions for this member
      db.prepare(
        "DELETE FROM org_member_sessions WHERE member_id = ? AND expires_at > datetime('now')",
      ).run(memberId);

      const { token, expiresAt } = createOrgSession(memberId);
      return { token, member, expiresAt };
    })();

    const res = NextResponse.json({
      ok: true,
      member: { id: claimResult.member.id, name: claimResult.member.name },
    });
    res.cookies.set(ORG_AUTH_COOKIE, claimResult.token, {
      ...ORG_AUTH_COOKIE_OPTIONS,
      expires: new Date(claimResult.expiresAt),
    });
    return res;
  }

  // Password check only: return member list with active status
  const members = db
    .prepare(
      `SELECT m.id, m.name,
              (SELECT COUNT(*) > 0 FROM org_member_sessions s
               WHERE s.member_id = m.id AND s.expires_at > datetime('now')) AS active
       FROM org_members m
       WHERE m.organization_id = ?
       ORDER BY m.name COLLATE NOCASE ASC`,
    )
    .all(org.id) as { id: string; name: string; active: number }[];

  return NextResponse.json({
    ok: true,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      active: Boolean(m.active),
    })),
  });
}

export const POST = handleOrgAuth;
export { handleOrgAuth };
