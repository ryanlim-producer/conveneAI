import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

const TEST_USER_ID = randomUUID(); const TEST_ORG_ID = randomUUID();
const ORG_PASSWORD = "original-password-123";

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { handleUpdateSettings } from "@/app/api/org/[orgId]/settings/route";

const ownerCtx = { orgContext: { type: "owner" as const, userId: TEST_USER_ID, email: "o@t.com", orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };
const memberCtx = { orgContext: { type: "member" as const, memberId: randomUUID(), orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(TEST_USER_ID);
  const hash = bcrypt.hashSync(ORG_PASSWORD, 1);
  db.prepare("INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Org', 'org', ?)").run(TEST_ORG_ID, TEST_USER_ID, hash);
  return db;
}

describe("org settings API", () => {
  let db: Database.Database;
  beforeEach(() => { db = setupTestDb(); getDbMock.mockReturnValue(db); });
  afterEach(() => { db.close(); vi.clearAllMocks(); });

  describe("PATCH", () => {
    it("updates the org password", async () => {
      const res = await handleUpdateSettings(new NextRequest("http://l/api", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "new-password-456" }),
      }), ownerCtx);
      expect(res.status).toBe(200);
      expect((await res.json()).ok).toBe(true);

      // Verify hash was updated in DB
      const row = db.prepare("SELECT password_hash FROM organizations WHERE id = ?").get(TEST_ORG_ID) as { password_hash: string };
      expect(bcrypt.compareSync("new-password-456", row.password_hash)).toBe(true);
      // Old password should no longer work
      expect(bcrypt.compareSync(ORG_PASSWORD, row.password_hash)).toBe(false);
    });

    it("rejects non-owner", async () => {
      const res = await handleUpdateSettings(new NextRequest("http://l/api", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "new-password-456" }),
      }), memberCtx);
      expect(res.status).toBe(403);
    });

    it("rejects empty password", async () => {
      const res = await handleUpdateSettings(new NextRequest("http://l/api", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "  " }),
      }), ownerCtx);
      expect(res.status).toBe(400);
    });

    it("rejects password shorter than 8 characters", async () => {
      const res = await handleUpdateSettings(new NextRequest("http://l/api", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "short" }),
      }), ownerCtx);
      expect(res.status).toBe(400);
    });

    it("rejects missing body", async () => {
      const res = await handleUpdateSettings(new NextRequest("http://l/api", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }), ownerCtx);
      expect(res.status).toBe(400);
    });
  });
});
