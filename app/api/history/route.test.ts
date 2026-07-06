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
import { handleGetHistory } from "@/app/api/history/route";

function setupTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'a@e.com', 'x')").run(
    TEST_USER_ID,
  );
  return db;
}

function insertUser(db: Database.Database): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(
    id,
    `${id}@example.com`,
  );
  return id;
}

function insertRecording(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    user_id: string;
    filename: string;
    source: string;
    duration_seconds: number;
    speaker_count: number;
    action_items_json: string;
    created_at: string;
  }> = {},
) {
  const rec = {
    id: randomUUID(),
    user_id: TEST_USER_ID,
    filename: "meeting.mp3",
    source: "desktop",
    duration_seconds: 60,
    speaker_count: 2,
    action_items_json: "[]",
    created_at: "2026-07-01 10:00:00",
    ...overrides,
  };
  db.prepare(
    `INSERT INTO recordings (id, user_id, filename, source, duration_seconds, speaker_count, action_items_json, created_at)
     VALUES (@id, @user_id, @filename, @source, @duration_seconds, @speaker_count, @action_items_json, @created_at)`,
  ).run(rec);
  return rec;
}

function mockReq(): NextRequest {
  return new NextRequest("http://localhost:3000/api/history");
}

function userCtx(userId = TEST_USER_ID) {
  return { user: { userId, email: "a@e.com" } };
}

describe("GET /api/history", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("returns empty list when no recordings exist", async () => {
    const res = await handleGetHistory(mockReq(), userCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ recordings: [], total: 0 });
  });

  it("returns recordings from all sources sorted newest first", async () => {
    insertRecording(db, {
      filename: "older.mp3",
      source: "desktop",
      created_at: "2026-07-01 10:00:00",
    });
    insertRecording(db, {
      filename: "newer.ogg",
      source: "telegram",
      created_at: "2026-07-02 10:00:00",
    });
    insertRecording(db, {
      filename: "newest.wav",
      source: "web_upload",
      created_at: "2026-07-03 10:00:00",
    });

    const res = await handleGetHistory(mockReq(), userCtx());
    const body = await res.json();

    expect(body.total).toBe(3);
    expect(body.recordings.map((r: { filename: string }) => r.filename)).toEqual([
      "newest.wav",
      "newer.ogg",
      "older.mp3",
    ]);
  });

  it("includes the linked job status", async () => {
    db.prepare(
      "INSERT INTO jobs (id, user_id, status, source, filename) VALUES ('job-1', ?, 'done', 'desktop', 'meeting.mp3')",
    ).run(TEST_USER_ID);
    const rec = insertRecording(db);
    db.prepare("UPDATE recordings SET job_id = 'job-1' WHERE id = ?").run(rec.id);

    const res = await handleGetHistory(mockReq(), userCtx());
    const body = await res.json();
    expect(body.recordings[0].jobStatus).toBe("done");
  });

  it("includes actionItemCount parsed from JSON", async () => {
    insertRecording(db, {
      action_items_json: JSON.stringify([
        { task: "enviar reporte", assignee: "María" },
        { task: "agendar reunión", assignee: null },
      ]),
    });

    const res = await handleGetHistory(mockReq(), userCtx());
    const body = await res.json();
    expect(body.recordings[0].actionItemCount).toBe(2);
  });

  it("treats malformed action_items_json as zero items", async () => {
    insertRecording(db, { action_items_json: "{not json" });

    const res = await handleGetHistory(mockReq(), userCtx());
    const body = await res.json();
    expect(body.recordings[0].actionItemCount).toBe(0);
  });

  it("does not leak recordings from other users", async () => {
    const otherUser = insertUser(db);
    insertRecording(db, { user_id: otherUser, filename: "other.mp3" });
    insertRecording(db, { filename: "mine.mp3" });

    const res = await handleGetHistory(mockReq(), userCtx());
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.recordings[0].filename).toBe("mine.mp3");
  });
});
