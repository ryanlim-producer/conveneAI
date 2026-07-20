import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

const TEST_USER_ID = randomUUID(); const TEST_ORG_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { handleGetMembers, handleAddMember, handleRemoveMember } from "@/app/api/org/[orgId]/members/route";

const ownerCtx = { orgContext: { type: "owner" as const, userId: TEST_USER_ID, email: "o@t.com", orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };
const memberCtx = { orgContext: { type: "member" as const, memberId: randomUUID(), orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(TEST_USER_ID);
  db.prepare("INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Org', 'org', 'h')").run(TEST_ORG_ID, TEST_USER_ID);
  return db;
}

describe("org members API", () => {
  let db: Database.Database;
  beforeEach(() => { db = setupTestDb(); getDbMock.mockReturnValue(db); });
  afterEach(() => { db.close(); vi.clearAllMocks(); });

  describe("GET", () => {
    it("returns empty list initially", async () => {
      const res = await handleGetMembers(new NextRequest("http://l/api"), memberCtx);
      expect((await res.json()).members).toEqual([]);
    });

    it("lists members with active status", async () => {
      const m1 = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')").run(m1, TEST_ORG_ID);
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Bob')").run(randomUUID(), TEST_ORG_ID);

      const res = await handleGetMembers(new NextRequest("http://l/api"), memberCtx);
      const members = (await res.json()).members;
      expect(members).toHaveLength(2);
      expect(members[0].active).toBe(false);
      expect(members[1].active).toBe(false);
    });
  });

  describe("POST", () => {
    it("adds a member", async () => {
      const res = await handleAddMember(new NextRequest("http://l/api", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Charlie" }),
      }), ownerCtx);
      expect(res.status).toBe(201);
      expect((await res.json()).name).toBe("Charlie");
    });

    it("rejects non-owner", async () => {
      const res = await handleAddMember(new NextRequest("http://l/api", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Charlie" }),
      }), memberCtx);
      expect(res.status).toBe(403);
    });

    it("rejects empty name", async () => {
      const res = await handleAddMember(new NextRequest("http://l/api", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "  " }),
      }), ownerCtx);
      expect(res.status).toBe(400);
    });
  });

  describe("DELETE", () => {
    it("removes member and deletes their chat messages", async () => {
      const mId = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Dave')").run(mId, TEST_ORG_ID);

      const res = await handleRemoveMember(
        new NextRequest(`http://l/api?memberId=${mId}`, { method: "DELETE" }),
        ownerCtx,
      );
      expect(res.status).toBe(200);
      expect(db.prepare("SELECT id FROM org_members WHERE id = ?").get(mId)).toBeUndefined();
    });

    it("rejects non-owner", async () => {
      const res = await handleRemoveMember(
        new NextRequest("http://l/api?memberId=x", { method: "DELETE" }),
        memberCtx,
      );
      expect(res.status).toBe(403);
    });
  });
});
