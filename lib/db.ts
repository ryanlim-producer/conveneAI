import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";

let db: Database.Database | null = null;

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.pragma(`table_info(${table})`) as { name: string }[];
  return rows.some((r) => r.name === column);
}

function tableExists(db: Database.Database, table: string): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
}

// Rebuilds a v1 table (session_id-scoped) into its v2 shape, preserving rows.
// Legacy rows keep user_id = NULL: they are never visible to any account but
// are not destroyed.
function migrateV1Tables(db: Database.Database): void {
  const needsRecordingsRebuild =
    tableExists(db, "recordings") && hasColumn(db, "recordings", "session_id");

  // The rebuilt recordings table references jobs, which is created later in
  // initSchema — suspend FK enforcement while copying legacy rows.
  if (needsRecordingsRebuild) db.pragma("foreign_keys = OFF");

  const migrate = db.transaction(() => {
    if (needsRecordingsRebuild) {
      db.exec(`
        ALTER TABLE recordings RENAME TO recordings_v1;
      `);
      createRecordingsTable(db);
      db.exec(`
        INSERT INTO recordings (id, user_id, filename, source, duration_seconds,
          speaker_count, s3_key, transcript_text, segments_json,
          action_items_json, speaker_map_json, model_used, cost_usd, created_at)
        SELECT id, NULL, filename, source, duration_seconds,
          speaker_count, NULL, transcript_text, segments_json,
          action_items_json, speaker_map_json, model_used, cost_usd, created_at
        FROM recordings_v1;
        DROP TABLE recordings_v1;
      `);
    }

    for (const table of ["api_keys", "telegram_links", "link_codes"]) {
      if (
        tableExists(db, table) &&
        hasColumn(db, table, "session_id") &&
        !hasColumn(db, table, "user_id")
      ) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT REFERENCES users(id)`);
      }
    }
  });
  try {
    migrate();
  } finally {
    if (needsRecordingsRebuild) db.pragma("foreign_keys = ON");
  }
}

function createJobsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recording_id TEXT REFERENCES recordings(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','transcribing','processing_action_items','done','error')),
      source TEXT NOT NULL CHECK(source IN ('desktop','telegram','web_upload')),
      s3_key TEXT,
      filename TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'en',
      error_message TEXT,
      model_used TEXT,
      attempts INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    );
  `);
}

// SQLite's RENAME TO rewrites foreign keys in other tables that point at the
// renamed table. An earlier schema version created jobs BEFORE the recordings
// v1→v2 rebuild, so its recording_id FK got dragged to recordings_v1 which was
// then dropped. Rebuild jobs (preserving rows) when we find that damage.
function repairDanglingJobsFk(db: Database.Database): void {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'")
    .get() as { sql: string } | undefined;
  if (!row || !row.sql.includes("recordings_v1")) return;

  db.pragma("foreign_keys = OFF");
  db.pragma("legacy_alter_table = ON"); // keep RENAME from rewriting other tables' FKs
  try {
    const repair = db.transaction(() => {
      db.exec("ALTER TABLE jobs RENAME TO jobs_damaged");
      createJobsTable(db);
      db.exec("INSERT INTO jobs SELECT * FROM jobs_damaged");
      db.exec("DROP TABLE jobs_damaged");
    });
    repair();
  } finally {
    db.pragma("legacy_alter_table = OFF");
    db.pragma("foreign_keys = ON");
  }
}

function createRecordingsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
      filename TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('desktop', 'telegram', 'web_upload')),
      duration_seconds REAL,
      speaker_count INTEGER DEFAULT 0,
      s3_key TEXT,
      transcript_text TEXT,
      segments_json TEXT,
      action_items_json TEXT,
      speaker_map_json TEXT,
      model_used TEXT,
      cost_usd REAL,
      group_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
  `);

  // Order matters: the v1→v2 recordings rebuild must run before any table
  // with a foreign key into recordings exists, or SQLite's RENAME drags
  // those FKs to the temporary recordings_v1 table (see repairDanglingJobsFk).
  migrateV1Tables(db);
  createRecordingsTable(db);
  if (!hasColumn(db, "recordings", "group_name")) {
    db.exec("ALTER TABLE recordings ADD COLUMN group_name TEXT");
  }
  if (!hasColumn(db, "recordings", "group_id")) {
    db.exec("ALTER TABLE recordings ADD COLUMN group_id TEXT REFERENCES groups(id) ON DELETE SET NULL");
  }
  repairDanglingJobsFk(db);
  createJobsTable(db);

  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, name COLLATE NOCASE)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      deepgram_model TEXT NOT NULL DEFAULT 'nova-3',
      actions_llm_model TEXT NOT NULL DEFAULT 'deepseek/deepseek-r1',
      chatbot_llm_model TEXT NOT NULL DEFAULT 'deepseek/deepseek-r1',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK(provider IN ('deepgram', 'vercel-ai-gateway')),
      encrypted_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS telegram_links (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      telegram_user_id INTEGER NOT NULL,
      telegram_chat_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS link_codes (
      code TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_recording ON chat_messages(recording_id);
    CREATE INDEX IF NOT EXISTS idx_recordings_user ON recordings(user_id);
    CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_telegram_links_user ON telegram_links(user_id);
  `);
}

export function getDb(): Database.Database {
  if (db) return db;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "conveneai.db");
  db = new Database(dbPath);

  // WAL mode for concurrent reads during writes
  db.pragma("journal_mode = WAL");
  // Busy timeout for concurrent access (5 seconds)
  db.pragma("busy_timeout = 5000");
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  initSchema(db);

  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function newId(): string {
  return randomUUID();
}
