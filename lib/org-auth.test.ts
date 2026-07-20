import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

const TEST_MEMBER_ID = randomUUID();
const TEST_ORG_ID = randomUUID();
const TEST_USER_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import {
  createOrgSession,
  validateOrgSession,
  destroyOrgSession,
  ORG_AUTH_COOKIE,
  ORG_SESSION_TTL_MS,
} from "@/lib/org-auth";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);

  // Create user + org + member
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(
    TEST_USER_ID,
  );
  db.prepare(
    "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Test Org', 'test-org', '$2a$04$...')",
  ).run(TEST_ORG_ID, TEST_USER_ID);
  db.prepare(
    "INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')",
  ).run(TEST_MEMBER_ID, TEST_ORG_ID);

  return db;
}

describe("org-auth", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe("createOrgSession", () => {
    it("creates a session and returns a token with expiration", () => {
      const result = createOrgSession(TEST_MEMBER_ID);
      expect(result.token).toBeTruthy();
      expect(typeof result.token).toBe("string");
      expect(result.token.length).toBe(64); // 32 bytes hex
      expect(result.expiresAt).toBeTruthy();

      // Verify persistence
      const row = db
        .prepare("SELECT * FROM org_member_sessions WHERE token = ?")
        .get(result.token) as { member_id: string; expires_at: string };
      expect(row.member_id).toBe(TEST_MEMBER_ID);
      expect(row.expires_at).toBe(result.expiresAt);
    });

    it("sets expiration 7 days in the future", () => {
      const before = new Date();
      const { expiresAt } = createOrgSession(TEST_MEMBER_ID);
      const expireDate = new Date(expiresAt);
      const diffMs = expireDate.getTime() - before.getTime();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
      // Allow ~1 second tolerance
      expect(diffMs).toBeGreaterThan(sevenDaysMs - 2000);
      expect(diffMs).toBeLessThan(sevenDaysMs + 2000);
    });

    it("generates a unique token each time", () => {
      const s1 = createOrgSession(TEST_MEMBER_ID);
      const s2 = createOrgSession(TEST_MEMBER_ID);
      expect(s1.token).not.toBe(s2.token);
    });
  });

  describe("validateOrgSession", () => {
    it("returns member info for a valid token", () => {
      const { token } = createOrgSession(TEST_MEMBER_ID);
      const result = validateOrgSession(token);
      expect(result).not.toBeNull();
      expect(result!.memberId).toBe(TEST_MEMBER_ID);
      expect(result!.orgId).toBe(TEST_ORG_ID);
    });

    it("returns null for an invalid token", () => {
      const result = validateOrgSession("not-a-real-token");
      expect(result).toBeNull();
    });

    it("returns null for an empty token", () => {
      const result = validateOrgSession("");
      expect(result).toBeNull();
    });

    it("returns null for an expired session", () => {
      // Insert an already-expired session
      const expiredToken = "expired-token-123";
      db.prepare(
        "INSERT INTO org_member_sessions (id, member_id, token, created_at, expires_at) VALUES (?, ?, ?, datetime('now', '-10 days'), datetime('now', '-3 days'))",
      ).run(randomUUID(), TEST_MEMBER_ID, expiredToken);

      const result = validateOrgSession(expiredToken);
      expect(result).toBeNull();
    });
  });

  describe("destroyOrgSession", () => {
    it("removes the session from the database", () => {
      const { token } = createOrgSession(TEST_MEMBER_ID);
      expect(validateOrgSession(token)).not.toBeNull();

      destroyOrgSession(token);
      expect(validateOrgSession(token)).toBeNull();

      // Verify row is gone
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM org_member_sessions WHERE token = ?")
        .get(token) as { n: number };
      expect(row.n).toBe(0);
    });

    it("is a no-op for an empty token", () => {
      expect(() => destroyOrgSession("")).not.toThrow();
    });

    it("is a no-op for a nonexistent token", () => {
      expect(() => destroyOrgSession("does-not-exist")).not.toThrow();
    });
  });

  describe("cookie configuration", () => {
    it("has the expected cookie name", () => {
      expect(ORG_AUTH_COOKIE).toBe("conveneai-org-auth");
    });

    it("has a 7-day TTL constant", () => {
      expect(ORG_SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});
