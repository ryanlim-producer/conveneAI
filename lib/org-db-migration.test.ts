import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { initSchema } from "@/lib/db";

function freshDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  return db;
}

function insertUser(db: Database.Database, id: string, email = `${id}@test.com`) {
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'hash')").run(id, email);
}

describe("organizations schema migration", () => {
  let db: Database.Database;

  afterEach(() => {
    db.close();
  });

  const newTables = ["organizations", "org_members", "org_member_sessions", "org_folder_links"];

  describe("new tables", () => {
    it("creates all four organization tables", () => {
      db = freshDb();
      initSchema(db);

      for (const table of newTables) {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table);
        expect(row, `table ${table} should exist`).toBeTruthy();
      }
    });

    it("organizations table has correct columns and constraints", () => {
      db = freshDb();
      initSchema(db);

      const cols = db.pragma("table_info(organizations)") as { name: string; notnull: number }[];
      const names = cols.map((c) => c.name);
      expect(names).toContain("id");
      expect(names).toContain("user_id");
      expect(names).toContain("name");
      expect(names).toContain("slug");
      expect(names).toContain("password_hash");
      expect(names).toContain("created_at");

      // slug must be unique
      const idx = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_orgs_slug'")
        .get() as { sql: string } | undefined;
      expect(idx).toBeTruthy();
    });

    it("org_members table has correct foreign key to organizations", () => {
      db = freshDb();
      initSchema(db);
      const userId = randomUUID();
      insertUser(db, userId);

      const orgId = randomUUID();
      db.prepare(
        "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, ?, ?, ?)",
      ).run(orgId, userId, "Test Org", "test-org", "hash");

      const memberId = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, ?)").run(
        memberId,
        orgId,
        "Alice",
      );

      const row = db.prepare("SELECT * FROM org_members WHERE id = ?").get(memberId) as {
        id: string;
        organization_id: string;
        name: string;
      };
      expect(row.name).toBe("Alice");
      expect(row.organization_id).toBe(orgId);

      // cascade: deleting org removes members
      db.prepare("DELETE FROM organizations WHERE id = ?").run(orgId);
      const remaining = db.prepare("SELECT COUNT(*) AS n FROM org_members").get() as { n: number };
      expect(remaining.n).toBe(0);
    });

    it("org_member_sessions table cascades from org_members", () => {
      db = freshDb();
      initSchema(db);
      const userId = randomUUID();
      insertUser(db, userId);

      const orgId = randomUUID();
      db.prepare(
        "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, ?, ?, ?)",
      ).run(orgId, userId, "Test Org", "test-org", "hash");

      const memberId = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, ?)").run(
        memberId,
        orgId,
        "Bob",
      );

      const sessionId = randomUUID();
      db.prepare(
        "INSERT INTO org_member_sessions (id, member_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+7 days'))",
      ).run(sessionId, memberId, "token-abc");

      // cascade: deleting member removes sessions
      db.prepare("DELETE FROM org_members WHERE id = ?").run(memberId);
      const remaining = db
        .prepare("SELECT COUNT(*) AS n FROM org_member_sessions")
        .get() as { n: number };
      expect(remaining.n).toBe(0);
    });

    it("org_folder_links enforces one-folder-per-org uniqueness", () => {
      db = freshDb();
      initSchema(db);
      const userId = randomUUID();
      insertUser(db, userId);

      const orgId = randomUUID();
      db.prepare(
        "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, ?, ?, ?)",
      ).run(orgId, userId, "Test Org", "test-org", "hash");

      const groupId = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'My Folder')").run(
        groupId,
        userId,
      );

      db.prepare(
        "INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)",
      ).run(orgId, groupId);

      // duplicate should throw
      expect(() => {
        db.prepare(
          "INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)",
        ).run(orgId, groupId);
      }).toThrow();

      // but folder CAN be linked to a different org (composite PK is org+group)
      const orgId2 = randomUUID();
      db.prepare(
        "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, ?, ?, ?)",
      ).run(orgId2, userId, "Other Org", "other-org", "hash");

      // Wait, composite PK means we can't insert same group into a different org either.
      // The UNIQUE on group_id prevents that — let's verify:
      expect(() => {
        db.prepare(
          "INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)",
        ).run(orgId2, groupId);
      }).toThrow(); // good — one folder → one org
    });

    it("org_folder_links cascades from organizations", () => {
      db = freshDb();
      initSchema(db);
      const userId = randomUUID();
      insertUser(db, userId);

      const orgId = randomUUID();
      db.prepare(
        "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, ?, ?, ?)",
      ).run(orgId, userId, "Test Org", "test-org", "hash");

      const groupId = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Folder')").run(
        groupId,
        userId,
      );
      db.prepare(
        "INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)",
      ).run(orgId, groupId);

      db.prepare("DELETE FROM organizations WHERE id = ?").run(orgId);
      const remaining = db
        .prepare("SELECT COUNT(*) AS n FROM org_folder_links")
        .get() as { n: number };
      expect(remaining.n).toBe(0);
    });
  });

  describe("chat_messages migration", () => {
    it("adds member_id column to chat_messages", () => {
      db = freshDb();
      initSchema(db);

      const cols = db.pragma("table_info(chat_messages)") as { name: string }[];
      const names = cols.map((c) => c.name);
      expect(names).toContain("member_id");
    });

    it("preserves existing chat messages after migration", () => {
      db = freshDb();
      initSchema(db);
      const userId = randomUUID();
      insertUser(db, userId);

      const recId = randomUUID();
      db.prepare(
        "INSERT INTO recordings (id, user_id, filename, source) VALUES (?, ?, 'm.mp3', 'web_upload')",
      ).run(recId, userId);

      db.prepare(
        "INSERT INTO chat_messages (id, recording_id, user_id, role, content) VALUES (?, ?, ?, 'user', 'hello')",
      ).run(randomUUID(), recId, userId);

      // run initSchema again (simulating restart after migration)
      initSchema(db);

      const msgs = db.prepare("SELECT * FROM chat_messages").all() as {
        role: string;
        content: string;
        member_id: string | null;
      }[];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe("user");
      expect(msgs[0].content).toBe("hello");
      expect(msgs[0].member_id).toBeNull(); // existing rows get NULL member_id
    });

    it("allows user_id to be NULL for org member messages", () => {
      db = freshDb();
      initSchema(db);
      const userId = randomUUID();
      insertUser(db, userId);

      const orgId = randomUUID();
      db.prepare(
        "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, ?, ?, ?)",
      ).run(orgId, userId, "Org", "org", "hash");

      const memberId = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, ?)").run(
        memberId,
        orgId,
        "Charlie",
      );

      const recId = randomUUID();
      db.prepare(
        "INSERT INTO recordings (id, user_id, filename, source) VALUES (?, ?, 'meeting.mp3', 'web_upload')",
      ).run(recId, userId);

      // insert with member_id and NULL user_id (member message)
      db.prepare(
        "INSERT INTO chat_messages (id, recording_id, user_id, member_id, role, content) VALUES (?, ?, NULL, ?, 'user', 'hi from member')",
      ).run(randomUUID(), recId, memberId);

      const msg = db
        .prepare("SELECT * FROM chat_messages WHERE member_id = ?")
        .get(memberId) as { user_id: null | string; content: string };
      expect(msg.content).toBe("hi from member");
      expect(msg.user_id).toBeNull();
    });

    it("member_id cascades on member deletion", () => {
      db = freshDb();
      initSchema(db);
      const userId = randomUUID();
      insertUser(db, userId);

      const orgId = randomUUID();
      db.prepare(
        "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, ?, ?, ?)",
      ).run(orgId, userId, "Org", "org", "hash");

      const memberId = randomUUID();
      db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, ?)").run(
        memberId,
        orgId,
        "Dave",
      );

      const recId = randomUUID();
      db.prepare(
        "INSERT INTO recordings (id, user_id, filename, source) VALUES (?, ?, 'm.mp3', 'desktop')",
      ).run(recId, userId);

      db.prepare(
        "INSERT INTO chat_messages (id, recording_id, user_id, member_id, role, content) VALUES (?, ?, NULL, ?, 'user', 'msg')",
      ).run(randomUUID(), recId, memberId);

      // delete member → messages cascade
      db.prepare("DELETE FROM org_members WHERE id = ?").run(memberId);
      const remaining = db
        .prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE member_id IS NOT NULL")
        .get() as { n: number };
      expect(remaining.n).toBe(0);
    });

    it("owner messages (user_id set, member_id NULL) still work", () => {
      db = freshDb();
      initSchema(db);
      const userId = randomUUID();
      insertUser(db, userId);

      const recId = randomUUID();
      db.prepare(
        "INSERT INTO recordings (id, user_id, filename, source) VALUES (?, ?, 'm.mp3', 'web_upload')",
      ).run(recId, userId);

      // owner message (existing pattern)
      db.prepare(
        "INSERT INTO chat_messages (id, recording_id, user_id, member_id, role, content) VALUES (?, ?, ?, NULL, 'user', 'owner msg')",
      ).run(randomUUID(), recId, userId);

      const msg = db
        .prepare("SELECT * FROM chat_messages WHERE user_id = ?")
        .get(userId) as { user_id: string; member_id: null };
      expect(msg.user_id).toBe(userId);
      expect(msg.member_id).toBeNull();
    });
  });

  describe("new indexes", () => {
    it("creates all required indexes", () => {
      db = freshDb();
      initSchema(db);

      const expectedIndexes = [
        "idx_orgs_owner",
        "idx_orgs_slug",
        "idx_org_members_org",
        "idx_org_sessions_token",
        "idx_org_sessions_member",
        "idx_org_folder_links_org",
        "idx_org_folder_links_group",
        "idx_chat_messages_member",
      ];

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all() as { name: string }[];

      const indexNames = new Set(indexes.map((i) => i.name));
      for (const idx of expectedIndexes) {
        expect(indexNames.has(idx), `index ${idx} should exist`).toBe(true);
      }
    });
  });

  describe("idempotency", () => {
    it("running initSchema multiple times does not fail", () => {
      db = freshDb();
      initSchema(db);
      initSchema(db);
      initSchema(db);

      // tables still exist
      for (const table of newTables) {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table);
        expect(row).toBeTruthy();
      }

      // chat_messages still has member_id
      const cols = db.pragma("table_info(chat_messages)") as { name: string }[];
      expect(cols.some((c) => c.name === "member_id")).toBe(true);
    });
  });
});
