import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";

const TEST_USER_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { handleRenameGroup, handleDeleteGroup } from "@/app/api/groups/[id]/route";

function setupTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'a@e.com', 'x')").run(
    TEST_USER_ID,
  );
  return db;
}

function insertGroup(db: Database.Database, name: string, userId = TEST_USER_ID): string {
  const id = randomUUID();
  db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, ?)").run(id, userId, name);
  return id;
}

function patch(groupId: string, body: Record<string, unknown>) {
  return handleRenameGroup(
    new NextRequest(`http://localhost:3000/api/groups/${groupId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { user: { userId: TEST_USER_ID, email: "a@e.com" }, params: { id: groupId } },
  );
}

describe("PATCH /api/groups/[id]", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("renames a group", async () => {
    const groupId = insertGroup(db, "Old Name");

    const res = await patch(groupId, { name: "New Name" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(groupId);
    expect(body.name).toBe("New Name");

    const row = db.prepare("SELECT name FROM groups WHERE id = ?").get(groupId) as { name: string };
    expect(row.name).toBe("New Name");
  });

  it("rejects rename to an existing group name with 409", async () => {
    insertGroup(db, "Existing");
    const groupId = insertGroup(db, "Target");

    const res = await patch(groupId, { name: "Existing" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });

  it("rejects rename to same name case-insensitively with 409", async () => {
    insertGroup(db, "Existing");
    const groupId = insertGroup(db, "Target");

    const res = await patch(groupId, { name: "existing" });
    expect(res.status).toBe(409);
  });

  it("allows renaming to the same name (idempotent)", async () => {
    const groupId = insertGroup(db, "My Folder");

    const res = await patch(groupId, { name: "My Folder" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("My Folder");
  });

  it("returns 404 for unknown group", async () => {
    const res = await patch("nonexistent", { name: "Test" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's group", async () => {
    const otherUser = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'b@e.com', 'x')").run(otherUser);
    const groupId = insertGroup(db, "Their Group", otherUser);

    const res = await patch(groupId, { name: "Nope" });
    expect(res.status).toBe(404);
  });

  it("rejects empty name with 400", async () => {
    const groupId = insertGroup(db, "My Folder");
    const res = await patch(groupId, { name: "   " });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /api/groups/[id]", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  function del(groupId: string) {
    return handleDeleteGroup(
      new NextRequest(`http://localhost:3000/api/groups/${groupId}`, {
        method: "DELETE",
      }),
      { user: { userId: TEST_USER_ID, email: "a@e.com" }, params: { id: groupId } },
    );
  }

  it("deletes a group and ungroups all its recordings", async () => {
    const groupId = insertGroup(db, "To Delete");

    // add recordings to the group
    for (let i = 0; i < 2; i++) {
      db.prepare(
        "INSERT INTO recordings (id, user_id, filename, source, group_id, group_name) VALUES (?, ?, ?, 'desktop', ?, ?)",
      ).run(randomUUID(), TEST_USER_ID, `meeting-${i}.mp3`, groupId, "To Delete");
    }

    const res = await del(groupId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.ungroupedCount).toBe(2);

    // group should be gone
    expect(db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId)).toBeUndefined();

    // recordings should be ungrouped
    const recordings = db
      .prepare("SELECT group_id, group_name FROM recordings WHERE user_id = ?")
      .all(TEST_USER_ID) as { group_id: string | null; group_name: string | null }[];
    for (const r of recordings) {
      expect(r.group_id).toBeNull();
      expect(r.group_name).toBeNull();
    }
  });

  it("deletes an empty group without issues", async () => {
    const groupId = insertGroup(db, "Empty");

    const res = await del(groupId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ungroupedCount).toBe(0);

    expect(db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId)).toBeUndefined();
  });

  it("returns 404 for unknown group", async () => {
    const res = await del("nonexistent");
    expect(res.status).toBe(404);
  });

  it("returns 404 for another user's group", async () => {
    const otherUser = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'b@e.com', 'x')").run(otherUser);
    const groupId = insertGroup(db, "Their Group", otherUser);

    const res = await del(groupId);
    expect(res.status).toBe(404);
    expect(db.prepare("SELECT id FROM groups WHERE id = ?").get(groupId)).toBeDefined();
  });
});
