import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

const TEST_USER_ID = randomUUID();
const TEST_ORG_ID = randomUUID();
const OTHER_USER_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { handleGetFolders, handleAddFolder, handleRemoveFolder } from "@/app/api/org/[orgId]/folders/route";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(TEST_USER_ID);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'x@t.com', 'h')").run(OTHER_USER_ID);
  db.prepare("INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Org', 'org', 'h')").run(TEST_ORG_ID, TEST_USER_ID);
  return db;
}

const ownerCtx = { orgContext: { type: "owner" as const, userId: TEST_USER_ID, email: "o@t.com", orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };
const memberCtx = { orgContext: { type: "member" as const, memberId: randomUUID(), orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };

async function getFolders(ctx = memberCtx) {
  return handleGetFolders(new NextRequest("http://localhost:3000/api/org/x/folders"), ctx);
}

async function addFolder(groupId: string) {
  return handleAddFolder(
    new NextRequest("http://localhost:3000/api/org/x/folders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId }),
    }),
    ownerCtx,
  );
}

async function removeFolder(groupId: string) {
  return handleRemoveFolder(
    new NextRequest(`http://localhost:3000/api/org/x/folders?groupId=${groupId}`, { method: "DELETE" }),
    ownerCtx,
  );
}

describe("org folders API", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe("GET /api/org/[orgId]/folders", () => {
    it("returns empty list when no folders are shared", async () => {
      const res = await getFolders();
      expect(res.status).toBe(200);
      expect((await res.json()).folders).toEqual([]);
    });

    it("lists shared folders with their recordings", async () => {
      const gid = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Standups')").run(gid, TEST_USER_ID);
      db.prepare("INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)").run(TEST_ORG_ID, gid);

      const recId = randomUUID();
      db.prepare("INSERT INTO recordings (id, user_id, filename, source, group_id) VALUES (?, ?, 'm.m4a', 'web_upload', ?)").run(recId, TEST_USER_ID, gid);

      const res = await getFolders();
      const body = await res.json();
      expect(body.folders).toHaveLength(1);
      expect(body.folders[0].name).toBe("Standups");
      expect(body.folders[0].recordings).toHaveLength(1);
      expect(body.folders[0].recordings[0].filename).toBe("m.m4a");
    });

    it("only returns folders shared to this org", async () => {
      const gid1 = randomUUID();
      const gid2 = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Shared')").run(gid1, TEST_USER_ID);
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Not Shared')").run(gid2, TEST_USER_ID);
      db.prepare("INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)").run(TEST_ORG_ID, gid1);

      const res = await getFolders();
      const folders = (await res.json()).folders;
      expect(folders).toHaveLength(1);
      expect(folders[0].name).toBe("Shared");
    });
  });

  describe("POST /api/org/[orgId]/folders", () => {
    it("adds a folder to the org", async () => {
      const gid = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'My Folder')").run(gid, TEST_USER_ID);

      const res = await addFolder(gid);
      expect(res.status).toBe(201);

      const link = db.prepare("SELECT * FROM org_folder_links WHERE group_id = ?").get(gid);
      expect(link).toBeTruthy();
    });

    it("rejects non-owner with 403", async () => {
      const gid = randomUUID();
      const res = await handleAddFolder(
        new NextRequest("http://localhost:3000/api/org/x/folders", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupId: gid }),
        }),
        memberCtx,
      );
      expect(res.status).toBe(403);
    });

    it("rejects folder already shared to another org with 409", async () => {
      const gid = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Folder')").run(gid, TEST_USER_ID);

      const otherOrgId = randomUUID();
      db.prepare("INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Other', 'other', 'h')").run(otherOrgId, TEST_USER_ID);
      db.prepare("INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)").run(otherOrgId, gid);

      const res = await addFolder(gid);
      expect(res.status).toBe(409);
    });

    it("returns 404 for nonexistent group", async () => {
      const res = await addFolder("nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/org/[orgId]/folders", () => {
    it("removes a folder from the org", async () => {
      const gid = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Folder')").run(gid, TEST_USER_ID);
      db.prepare("INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)").run(TEST_ORG_ID, gid);

      const res = await removeFolder(gid);
      expect(res.status).toBe(200);

      const link = db.prepare("SELECT * FROM org_folder_links WHERE group_id = ?").get(gid);
      expect(link).toBeUndefined();
    });
  });
});
