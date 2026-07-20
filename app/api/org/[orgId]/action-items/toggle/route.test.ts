import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

const TEST_USER_ID = randomUUID(); const TEST_ORG_ID = randomUUID();
const TEST_GROUP_ID = randomUUID(); const TEST_RECORDING_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { handleToggleActionItem } from "@/app/api/org/[orgId]/action-items/toggle/route";

const ownerCtx = { orgContext: { type: "owner" as const, userId: TEST_USER_ID, email: "o@t.com", orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };
const memberCtx = { orgContext: { type: "member" as const, memberId: randomUUID(), orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };

const initialItems = [
  { task: "Review Q1 report", assignee: "Alice", deadline: "2026-03-15", context: "From meeting" },
  { task: "Update roadmap", assignee: "", deadline: "", context: "" },
];

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(TEST_USER_ID);
  db.prepare("INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Org', 'org', 'h')").run(TEST_ORG_ID, TEST_USER_ID);
  db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Shared')").run(TEST_GROUP_ID, TEST_USER_ID);
  db.prepare("INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)").run(TEST_ORG_ID, TEST_GROUP_ID);
  db.prepare("INSERT INTO recordings (id, user_id, group_id, filename, source, action_items_json) VALUES (?, ?, ?, 'test.m4a', 'web_upload', ?)").run(TEST_RECORDING_ID, TEST_USER_ID, TEST_GROUP_ID, JSON.stringify(initialItems));
  return db;
}

describe("org action-items toggle", () => {
  let db: Database.Database;
  beforeEach(() => { db = setupTestDb(); getDbMock.mockReturnValue(db); });
  afterEach(() => { db.close(); vi.clearAllMocks(); });

  it("member can mark an item completed", async () => {
    const res = await handleToggleActionItem(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: TEST_RECORDING_ID, itemIndex: 0, completed: true }),
    }), memberCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const row = db.prepare("SELECT action_items_json FROM recordings WHERE id = ?").get(TEST_RECORDING_ID) as { action_items_json: string };
    const saved = JSON.parse(row.action_items_json);
    expect(saved[0].completed).toBe(true);
    expect(saved[1].completed).toBeFalsy();
    // Task text/assignee/deadline untouched
    expect(saved[0].task).toBe("Review Q1 report");
  });

  it("owner can mark an item completed", async () => {
    const res = await handleToggleActionItem(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: TEST_RECORDING_ID, itemIndex: 1, completed: true }),
    }), ownerCtx);
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT action_items_json FROM recordings WHERE id = ?").get(TEST_RECORDING_ID) as { action_items_json: string };
    const saved = JSON.parse(row.action_items_json);
    expect(saved[1].completed).toBe(true);
  });

  it("can uncheck a completed item", async () => {
    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
      .run(JSON.stringify([{ ...initialItems[0], completed: true }, initialItems[1]]), TEST_RECORDING_ID);

    const res = await handleToggleActionItem(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: TEST_RECORDING_ID, itemIndex: 0, completed: false }),
    }), memberCtx);
    expect(res.status).toBe(200);
    const row = db.prepare("SELECT action_items_json FROM recordings WHERE id = ?").get(TEST_RECORDING_ID) as { action_items_json: string };
    const saved = JSON.parse(row.action_items_json);
    expect(saved[0].completed).toBe(false);
  });

  it("rejects recording not in shared folder", async () => {
    const res = await handleToggleActionItem(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: "nonexistent", itemIndex: 0, completed: true }),
    }), memberCtx);
    expect(res.status).toBe(404);
  });

  it("rejects out-of-range itemIndex", async () => {
    const res = await handleToggleActionItem(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: TEST_RECORDING_ID, itemIndex: 99, completed: true }),
    }), memberCtx);
    expect(res.status).toBe(400);
  });

  it("rejects missing recordingId", async () => {
    const res = await handleToggleActionItem(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIndex: 0, completed: true }),
    }), memberCtx);
    expect(res.status).toBe(400);
  });
});
