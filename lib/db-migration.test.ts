import { describe, it, expect, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { enqueueJob } from "@/lib/queue";

/** Recreates the exact v1 schema this app shipped with. */
function createV1Db(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE recordings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('desktop', 'telegram')),
      duration_seconds REAL,
      speaker_count INTEGER DEFAULT 0,
      mp3_path TEXT,
      transcript_text TEXT,
      segments_json TEXT,
      action_items_json TEXT,
      speaker_map_json TEXT,
      model_used TEXT DEFAULT 'nova-2',
      cost_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('deepgram', 'vercel-ai-gateway')),
      encrypted_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE telegram_links (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      telegram_chat_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE link_codes (
      code TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    "INSERT INTO recordings (id, session_id, filename, source, transcript_text) VALUES ('v1-rec', 'old-session', 'legacy.mp3', 'desktop', 'hola')",
  ).run();
  return db;
}

describe("v1 → v2 database migration", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  it("migrates a v1 database so jobs can be enqueued (no dangling FK from table rename)", () => {
    db = createV1Db();
    initSchema(db);
    getDbMock.mockReturnValue(db);

    const userId = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'a@e.com', 'x')").run(
      userId,
    );

    // this is what exploded on the real dev DB: jobs' FK pointed at the
    // dropped recordings_v1 after the rename
    const job = enqueueJob({ userId, filename: "new.mp3", s3Key: "k", source: "web_upload" });
    expect(job.status).toBe("queued");

    // and jobs can link to a v2 recording
    db.prepare(
      "INSERT INTO recordings (id, user_id, filename, source) VALUES ('v2-rec', ?, 'n.mp3', 'web_upload')",
    ).run(userId);
    db.prepare("UPDATE jobs SET recording_id = 'v2-rec' WHERE id = ?").run(job.id);
  });

  it("preserves v1 recordings with a NULL user_id", () => {
    db = createV1Db();
    initSchema(db);

    const legacy = db.prepare("SELECT * FROM recordings WHERE id = 'v1-rec'").get() as Record<
      string,
      unknown
    >;
    expect(legacy.filename).toBe("legacy.mp3");
    expect(legacy.user_id).toBeNull();
  });

  it("is idempotent across repeated boots", () => {
    db = createV1Db();
    initSchema(db);
    initSchema(db);
    initSchema(db);

    expect(db.prepare("SELECT COUNT(*) AS n FROM recordings").get()).toEqual({ n: 1 });
  });

  it("repairs a database already damaged by the rename bug", () => {
    db = createV1Db();
    // simulate the buggy order: jobs created BEFORE the rename, FK dragged along
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recording_id TEXT REFERENCES recordings(id) ON DELETE SET NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','transcribing','processing_action_items','done','error')),
        source TEXT NOT NULL CHECK(source IN ('desktop','telegram','web_upload')),
        s3_key TEXT, filename TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'es',
        error_message TEXT, model_used TEXT, attempts INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), started_at TEXT, completed_at TEXT
      );
      ALTER TABLE recordings RENAME TO recordings_v1;
      CREATE TABLE recordings (
        id TEXT PRIMARY KEY, user_id TEXT, job_id TEXT, filename TEXT NOT NULL,
        source TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      DROP TABLE recordings_v1;
    `);

    const jobsSql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'jobs'").get() as { sql: string }
    ).sql;
    expect(jobsSql).toContain("recordings_v1"); // damage confirmed

    initSchema(db);
    getDbMock.mockReturnValue(db);

    const userId = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'b@e.com', 'x')").run(
      userId,
    );
    const job = enqueueJob({ userId, filename: "ok.mp3", s3Key: "k", source: "desktop" });
    expect(job.status).toBe("queued");
  });
});
