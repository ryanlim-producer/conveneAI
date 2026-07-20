import { randomBytes } from "crypto";
import { getDb, newId } from "./db";

export const ORG_AUTH_COOKIE = "conveneai-org-auth";
export const ORG_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface OrgSessionMember {
  memberId: string;
  orgId: string;
}

export function createOrgSession(
  memberId: string,
): { token: string; expiresAt: string } {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ORG_SESSION_TTL_MS).toISOString();
  db.prepare(
    "INSERT INTO org_member_sessions (id, member_id, token, expires_at) VALUES (?, ?, ?, ?)",
  ).run(newId(), memberId, token, expiresAt);
  return { token, expiresAt };
}

export function validateOrgSession(token: string): OrgSessionMember | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.id AS member_id, m.organization_id AS org_id
       FROM org_member_sessions s
       JOIN org_members m ON m.id = s.member_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as { member_id: string; org_id: string } | undefined;
  return row ? { memberId: row.member_id, orgId: row.org_id } : null;
}

export function destroyOrgSession(token: string): void {
  if (!token) return;
  getDb().prepare("DELETE FROM org_member_sessions WHERE token = ?").run(token);
}
