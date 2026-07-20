import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

const TEST_USER_ID = randomUUID(); const TEST_ORG_ID = randomUUID();
const TEST_GROUP_ID = randomUUID();
const REC_A = randomUUID(); const REC_B = randomUUID(); const REC_C = randomUUID();
const MEMBER_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema, newId } from "@/lib/db";
import { handleGetRecentChats } from "@/app/api/org/[orgId]/recent-chats/route";

const ownerCtx = { orgContext: { type: "owner" as const, userId: TEST_USER_ID, email: "o@t.com", orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };
const memberCtx = { orgContext: { type: "member" as const, memberId: MEMBER_ID, orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(TEST_USER_ID);
  db.prepare("INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Org', 'org', 'h')").run(TEST_ORG_ID, TEST_USER_ID);
  db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Shared')").run(TEST_GROUP_ID, TEST_USER_ID);
  db.prepare("INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)").run(TEST_ORG_ID, TEST_GROUP_ID);
  db.prepare("INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')").run(MEMBER_ID, TEST_ORG_ID);
  for (const [id, name] of [[REC_A, "A.m4a"], [REC_B, "B.m4a"], [REC_C, "C.m4a"]]) {
    db.prepare("INSERT INTO recordings (id, user_id, group_id, filename, source, action_items_json) VALUES (?, ?, ?, ?, 'web_upload', '[]')").run(id, TEST_USER_ID, TEST_GROUP_ID, name);
  }
  return db;
}

function insertChat(db: Database.Database, recordingId: string, opts: { userId?: string; memberId?: string }, role: "user" | "assistant", content: string, createdAt: string) {
  db.prepare(
    "INSERT INTO chat_messages (id, recording_id, user_id, member_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(newId(), recordingId, opts.userId ?? null, opts.memberId ?? null, role, content, createdAt);
}

describe("org recent-chats GET", () => {
  let db: Database.Database;
  beforeEach(() => { db = setupTestDb(); getDbMock.mockReturnValue(db); });
  afterEach(() => { db.close(); vi.clearAllMocks(); });

  it("returns recordings the member has chatted in, most recent first", async () => {
    insertChat(db, REC_A, { memberId: MEMBER_ID }, "user", "hello", "2026-01-01 10:00:00");
    insertChat(db, REC_A, { memberId: MEMBER_ID }, "assistant", "hi there", "2026-01-01 10:00:05");
    insertChat(db, REC_B, { memberId: MEMBER_ID }, "user", "what about this", "2026-01-02 09:00:00");
    insertChat(db, REC_B, { memberId: MEMBER_ID }, "assistant", "sure, here's the answer", "2026-01-02 09:00:05");

    const res = await handleGetRecentChats(new NextRequest("http://l/api"), memberCtx);
    const body = await res.json();
    expect(body.chats).toHaveLength(2);
    expect(body.chats[0].recordingId).toBe(REC_B); // most recent
    expect(body.chats[1].recordingId).toBe(REC_A);
    expect(body.chats[0].lastMessage).toBe("sure, here's the answer");
  });

  it("scopes to the owner's own chat thread", async () => {
    insertChat(db, REC_C, { userId: TEST_USER_ID }, "user", "owner question", "2026-01-03 08:00:00");
    insertChat(db, REC_C, { userId: TEST_USER_ID }, "assistant", "owner answer", "2026-01-03 08:00:05");
    insertChat(db, REC_A, { memberId: MEMBER_ID }, "user", "member question", "2026-01-04 08:00:00");

    const res = await handleGetRecentChats(new NextRequest("http://l/api"), ownerCtx);
    const body = await res.json();
    expect(body.chats).toHaveLength(1);
    expect(body.chats[0].recordingId).toBe(REC_C);
  });

  it("returns empty list when no chats exist", async () => {
    const res = await handleGetRecentChats(new NextRequest("http://l/api"), memberCtx);
    const body = await res.json();
    expect(body.chats).toEqual([]);
  });

  it("excludes recordings outside shared folders", async () => {
    const outsideRec = randomUUID();
    db.prepare("INSERT INTO recordings (id, user_id, filename, source, action_items_json) VALUES (?, ?, 'outside.m4a', 'web_upload', '[]')").run(outsideRec, TEST_USER_ID);
    insertChat(db, outsideRec, { memberId: MEMBER_ID }, "user", "hi", "2026-01-01 10:00:00");

    const res = await handleGetRecentChats(new NextRequest("http://l/api"), memberCtx);
    const body = await res.json();
    expect(body.chats).toEqual([]);
  });
});
