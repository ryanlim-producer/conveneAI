import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

process.env.BCRYPT_ROUNDS = "4";

const TEST_USER_ID = randomUUID();
const TEST_ORG_ID = randomUUID();
const TEST_ORG_SLUG = "test-org";
const TEST_PASSWORD = "secret123";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { POST as orgAuth, handleOrgAuth } from "@/app/api/org/auth/route";
import { handleOrgLogout } from "@/app/api/org/auth/logout/route";
import { ORG_AUTH_COOKIE, validateOrgSession } from "@/lib/org-auth";

async function setupOrg(db: Database.Database): Promise<string> {
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  db.prepare(
    "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Test Org', ?, ?)",
  ).run(TEST_ORG_ID, TEST_USER_ID, TEST_ORG_SLUG, passwordHash);
  return passwordHash;
}

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(
    TEST_USER_ID,
  );
  return db;
}

function authReq(body: Record<string, unknown>) {
  return handleOrgAuth(
    new NextRequest("http://localhost:3000/api/org/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/org/auth", () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
    await setupOrg(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe("password validation", () => {
    it("returns member list for correct password", async () => {
      // Add members
      const m1 = randomUUID();
      const m2 = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')").run(m1, TEST_ORG_ID);
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Bob')").run(m2, TEST_ORG_ID);

      const res = await authReq({ slug: TEST_ORG_SLUG, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.members).toHaveLength(2);
      expect(body.members.map((m: { name: string }) => m.name).sort()).toEqual(["Alice", "Bob"]);
    });

    it("marks members with active sessions", async () => {
      const m1 = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')").run(m1, TEST_ORG_ID);

      const { createOrgSession } = await import("@/lib/org-auth");
      createOrgSession(m1);

      const res = await authReq({ slug: TEST_ORG_SLUG, password: TEST_PASSWORD });
      const members = (await res.json()).members;
      expect(members[0].active).toBe(true);
    });

    it("returns empty member list when no members exist", async () => {
      const res = await authReq({ slug: TEST_ORG_SLUG, password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.members).toEqual([]);
    });

    it("returns 401 for wrong password", async () => {
      const res = await authReq({ slug: TEST_ORG_SLUG, password: "wrongpassword" });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain("Incorrect");
    });

    it("returns 404 for nonexistent org slug", async () => {
      const res = await authReq({ slug: "nonexistent", password: TEST_PASSWORD });
      expect(res.status).toBe(404);
    });

    it("returns 400 for missing slug", async () => {
      const res = await authReq({ password: TEST_PASSWORD });
      expect(res.status).toBe(400);
    });
  });

  describe("member claiming", () => {
    it("claims a member and sets a session cookie", async () => {
      const memberId = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')").run(memberId, TEST_ORG_ID);

      const res = await authReq({
        slug: TEST_ORG_SLUG,
        password: TEST_PASSWORD,
        claimMemberId: memberId,
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.member.id).toBe(memberId);
      expect(body.member.name).toBe("Alice");

      // Cookie is set
      const cookie = res.cookies.get(ORG_AUTH_COOKIE);
      expect(cookie?.value).toBeTruthy();
      expect(cookie?.httpOnly).toBe(true);
    });

    it("kicks out existing session when claiming an active member", async () => {
      const memberId = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')").run(memberId, TEST_ORG_ID);

      const { createOrgSession } = await import("@/lib/org-auth");
      const oldSession = createOrgSession(memberId);

      const res = await authReq({
        slug: TEST_ORG_SLUG,
        password: TEST_PASSWORD,
        claimMemberId: memberId,
      });
      // Old session is destroyed, new session created — should succeed
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.member.name).toBe("Alice");

      // Old session should be invalid
      const { validateOrgSession } = await import("@/lib/org-auth");
      expect(validateOrgSession(oldSession.token)).toBeNull();

      // New session should be valid
      const newCookie = res.cookies.get(ORG_AUTH_COOKIE);
      expect(validateOrgSession(newCookie!.value)).not.toBeNull();
    });

    it("returns 404 when member does not exist in this org", async () => {
      const res = await authReq({
        slug: TEST_ORG_SLUG,
        password: TEST_PASSWORD,
        claimMemberId: "nonexistent",
      });
      expect(res.status).toBe(404);
    });

    it("still requires correct password when claiming", async () => {
      const memberId = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')").run(memberId, TEST_ORG_ID);

      const res = await authReq({
        slug: TEST_ORG_SLUG,
        password: "wrong",
        claimMemberId: memberId,
      });
      expect(res.status).toBe(401);
    });

    it("returns 400 for non-JSON body", async () => {
      const req = new NextRequest("http://localhost:3000/api/org/auth", {
        method: "POST",
        body: "not json",
      });
      const res = await handleOrgAuth(req);
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/org/auth/logout", () => {
    it("destroys the session and clears the cookie", async () => {
      // First claim a member to get a session
      const memberId = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')").run(memberId, TEST_ORG_ID);

      const claimRes = await authReq({
        slug: TEST_ORG_SLUG,
        password: TEST_PASSWORD,
        claimMemberId: memberId,
      });
      const token = claimRes.cookies.get(ORG_AUTH_COOKIE)!.value;
      expect(validateOrgSession(token)).not.toBeNull();

      // Now logout
      const logoutRes = await handleOrgLogout(
        new NextRequest("http://localhost:3000/api/org/auth/logout", {
          method: "POST",
          headers: { cookie: `${ORG_AUTH_COOKIE}=${token}` },
        }),
      );
      expect(logoutRes.status).toBe(200);

      expect(validateOrgSession(token)).toBeNull();
      expect(logoutRes.cookies.get(ORG_AUTH_COOKIE)?.value).toBe("");
    });
  });
});
