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
import { handleUpdateActionItems, handleGetActionItems } from "@/app/api/org/[orgId]/action-items/route";

const ownerCtx = { orgContext: { type: "owner" as const, userId: TEST_USER_ID, email: "o@t.com", orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };
const memberCtx = { orgContext: { type: "member" as const, memberId: randomUUID(), orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };

const validItems = [
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
  db.prepare("INSERT INTO recordings (id, user_id, group_id, filename, source, action_items_json) VALUES (?, ?, ?, 'test.m4a', 'web_upload', '[]')").run(TEST_RECORDING_ID, TEST_USER_ID, TEST_GROUP_ID);
  return db;
}

describe("org action-items PATCH", () => {
  let db: Database.Database;
  beforeEach(() => { db = setupTestDb(); getDbMock.mockReturnValue(db); });
  afterEach(() => { db.close(); vi.clearAllMocks(); });

  it("owner updates action items for a shared recording", async () => {
    const res = await handleUpdateActionItems(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: TEST_RECORDING_ID, actionItems: validItems }),
    }), ownerCtx);
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });

    const row = db.prepare("SELECT action_items_json FROM recordings WHERE id = ?").get(TEST_RECORDING_ID) as { action_items_json: string };
    const saved = JSON.parse(row.action_items_json);
    expect(saved).toHaveLength(2);
    expect(saved[0].task).toBe("Review Q1 report");
  });

  it("rejects non-owner", async () => {
    const res = await handleUpdateActionItems(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: TEST_RECORDING_ID, actionItems: validItems }),
    }), memberCtx);
    expect(res.status).toBe(403);
  });

  it("rejects recording not in shared folder", async () => {
    const res = await handleUpdateActionItems(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: "nonexistent", actionItems: validItems }),
    }), ownerCtx);
    expect(res.status).toBe(404);
  });

  it("rejects missing recordingId", async () => {
    const res = await handleUpdateActionItems(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionItems: validItems }),
    }), ownerCtx);
    expect(res.status).toBe(400);
  });

  it("rejects empty task item", async () => {
    const res = await handleUpdateActionItems(new NextRequest("http://l/api", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: TEST_RECORDING_ID, actionItems: [{ task: "  ", assignee: "", deadline: "", context: "" }] }),
    }), ownerCtx);
    expect(res.status).toBe(400);
  });
});

describe("org action-items GET", () => {
  let db: Database.Database;
  beforeEach(() => { db = setupTestDb(); getDbMock.mockReturnValue(db); });
  afterEach(() => { db.close(); vi.clearAllMocks(); });

  it("includes recordingCreatedAt on each item so the UI can group/sort by meeting date", async () => {
    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
      .run(JSON.stringify(validItems), TEST_RECORDING_ID);

    const res = await handleGetActionItems(new NextRequest("http://l/api"), ownerCtx);
    const body = await res.json();
    expect(body.folders).toHaveLength(1);
    const item = body.folders[0].items[0];
    expect(item.recordingCreatedAt).toBeTruthy();
    expect(typeof item.recordingCreatedAt).toBe("string");
  });

  it("includes itemIndex and completed so the UI can toggle without ambiguity", async () => {
    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
      .run(JSON.stringify([
        { task: "First", assignee: "", deadline: "", context: "" },
        { task: "Second", assignee: "", deadline: "", context: "", completed: true },
      ]), TEST_RECORDING_ID);

    const res = await handleGetActionItems(new NextRequest("http://l/api"), ownerCtx);
    const body = await res.json();
    const items = body.folders[0].items;
    expect(items[0].itemIndex).toBe(0);
    expect(items[0].completed).toBe(false);
    expect(items[1].itemIndex).toBe(1);
    expect(items[1].completed).toBe(true);
  });
});
