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
import { handleCreateGroup, handleListGroups } from "@/app/api/groups/route";

function setupTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'a@e.com', 'x')").run(
    TEST_USER_ID,
  );
  return db;
}

function post(name: string) {
  return handleCreateGroup(
    new NextRequest("http://localhost:3000/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    { user: { userId: TEST_USER_ID, email: "a@e.com" } },
  );
}

function postBody(body: Record<string, unknown>) {
  return handleCreateGroup(
    new NextRequest("http://localhost:3000/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { user: { userId: TEST_USER_ID, email: "a@e.com" } },
  );
}

describe("POST /api/groups", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("creates a group and returns it with id, name, and created_at", async () => {
    const res = await post("Standup");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.name).toBe("Standup");
    expect(body.createdAt).toBeTruthy();

    // verify persisted
    const row = db.prepare("SELECT * FROM groups WHERE name = 'Standup'").get() as {
      id: string;
      name: string;
    };
    expect(row.id).toBe(body.id);
    expect(row.name).toBe("Standup");
  });

  it("rejects a duplicate group name with 409", async () => {
    await post("Standup");
    const res = await post("Standup");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("already exists");
  });

  it("treats case-insensitive duplicates as conflicts", async () => {
    await post("Standup");
    const res = await post("standup");
    expect(res.status).toBe(409);
  });

  it("trims whitespace from the name", async () => {
    const res = await post("  Daily   ");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Daily");
  });

  it("rejects an empty name with 400", async () => {
    const res = await post("   ");
    expect(res.status).toBe(400);
  });

  it("rejects a missing name field with 400", async () => {
    const res = await postBody({});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/groups", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  async function list() {
    return handleListGroups(
      new NextRequest("http://localhost:3000/api/groups"),
      { user: { userId: TEST_USER_ID, email: "a@e.com" } },
    );
  }

  it("returns empty array when no groups exist", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ groups: [] });
  });

  it("returns groups sorted alphabetically", async () => {
    await post("Design reviews");
    await post("Daily standup");
    await post("1:1s");

    const res = await list();
    const body = await res.json();
    expect(body.groups.map((g: { name: string }) => g.name)).toEqual([
      "1:1s",
      "Daily standup",
      "Design reviews",
    ]);
  });

  it("includes recording count for each group", async () => {
    await post("Team");

    const groupId = (db.prepare("SELECT id FROM groups WHERE name = 'Team'").get() as { id: string }).id;

    // add 3 recordings to this group
    for (let i = 0; i < 3; i++) {
      db.prepare(
        "INSERT INTO recordings (id, user_id, filename, source, group_id) VALUES (?, ?, ?, 'desktop', ?)",
      ).run(randomUUID(), TEST_USER_ID, `meeting-${i}.mp3`, groupId);
    }

    const res = await list();
    const body = await res.json();
    expect(body.groups[0].name).toBe("Team");
    expect(body.groups[0].recordingCount).toBe(3);
  });

  it("does not leak groups from other users", async () => {
    await post("My group");

    const otherUser = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'b@e.com', 'x')").run(otherUser);
    db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Their group')").run(
      randomUUID(),
      otherUser,
    );

    const res = await list();
    const body = await res.json();
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].name).toBe("My group");
  });
});
