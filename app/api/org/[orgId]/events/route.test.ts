import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

const TEST_USER_ID = randomUUID(); const TEST_ORG_ID = randomUUID();
const GROUP_A = randomUUID(); const GROUP_B = randomUUID();

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { getOrgSnapshot } from "@/app/api/org/[orgId]/events/route";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(TEST_USER_ID);
  db.prepare("INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Org', 'org', 'h')").run(TEST_ORG_ID, TEST_USER_ID);
  db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Alpha')").run(GROUP_A, TEST_USER_ID);
  db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Beta')").run(GROUP_B, TEST_USER_ID);
  db.prepare("INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)").run(TEST_ORG_ID, GROUP_A);
  db.prepare("INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)").run(TEST_ORG_ID, GROUP_B);
  return db;
}

function insertRecording(db: Database.Database, groupId: string): string {
  const id = randomUUID();
  db.prepare("INSERT INTO recordings (id, user_id, group_id, filename, source, action_items_json) VALUES (?, ?, ?, 'rec.m4a', 'web_upload', '[]')")
    .run(id, TEST_USER_ID, groupId);
  return id;
}

describe("org events snapshot", () => {
  let db: Database.Database;
  beforeEach(() => { db = setupTestDb(); getDbMock.mockReturnValue(db); });
  afterEach(() => { db.close(); vi.clearAllMocks(); });

  it("changes when a recording moves from one shared folder to another (net-zero count change)", () => {
    const recId = insertRecording(db, GROUP_A);
    const before = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    db.prepare("UPDATE recordings SET group_id = ? WHERE id = ?").run(GROUP_B, recId);
    const after = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    expect(after).not.toBe(before);
  });

  it("includes actual recording IDs per folder, not just a count", () => {
    const recId = insertRecording(db, GROUP_A);
    const snapshot = getOrgSnapshot(TEST_ORG_ID);
    const folderA = snapshot.folders.find((f) => f.id === GROUP_A);
    expect(folderA?.recordingIds).toEqual([recId]);
  });

  it("changes when a new recording is added to a shared folder", () => {
    const before = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));
    insertRecording(db, GROUP_A);
    const after = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));
    expect(after).not.toBe(before);
  });

  it("changes when a recording is removed from a shared folder (unlinked to no folder)", () => {
    const recId = insertRecording(db, GROUP_A);
    const before = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    db.prepare("UPDATE recordings SET group_id = NULL WHERE id = ?").run(recId);
    const after = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    expect(after).not.toBe(before);
  });

  it("changes when action items are added to a recording", () => {
    const recId = insertRecording(db, GROUP_A);
    const before = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
      .run(JSON.stringify([{ task: "Do the thing", assignee: "", deadline: "", context: "" }]), recId);
    const after = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    expect(after).not.toBe(before);
  });

  it("changes when an action item is edited", () => {
    const recId = insertRecording(db, GROUP_A);
    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
      .run(JSON.stringify([{ task: "Original task", assignee: "", deadline: "", context: "" }]), recId);
    const before = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
      .run(JSON.stringify([{ task: "Edited task", assignee: "", deadline: "", context: "" }]), recId);
    const after = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    expect(after).not.toBe(before);
  });

  it("changes when an action item is toggled complete", () => {
    const recId = insertRecording(db, GROUP_A);
    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
      .run(JSON.stringify([{ task: "Task", assignee: "", deadline: "", context: "", completed: false }]), recId);
    const before = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
      .run(JSON.stringify([{ task: "Task", assignee: "", deadline: "", context: "", completed: true }]), recId);
    const after = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    expect(after).not.toBe(before);
  });

  it("changes when an action item is deleted", () => {
    const recId = insertRecording(db, GROUP_A);
    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?")
      .run(JSON.stringify([{ task: "Task", assignee: "", deadline: "", context: "" }]), recId);
    const before = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    db.prepare("UPDATE recordings SET action_items_json = ? WHERE id = ?").run("[]", recId);
    const after = JSON.stringify(getOrgSnapshot(TEST_ORG_ID));

    expect(after).not.toBe(before);
  });
});
