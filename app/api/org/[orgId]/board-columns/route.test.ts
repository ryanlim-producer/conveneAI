import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

const TEST_USER_ID = randomUUID();
const TEST_ORG_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { handleGetColumns, handleAddColumn } from "@/app/api/org/[orgId]/board-columns/route";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(TEST_USER_ID);
  db.prepare("INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Org', 'org', 'h')").run(TEST_ORG_ID, TEST_USER_ID);
  return db;
}

const ownerCtx = { orgContext: { type: "owner" as const, userId: TEST_USER_ID, email: "o@t.com", orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };
const memberCtx = { orgContext: { type: "member" as const, memberId: randomUUID(), orgId: TEST_ORG_ID }, params: { orgId: TEST_ORG_ID } };

async function getColumns(ctx = memberCtx) {
  return handleGetColumns(new NextRequest("http://localhost:3000/api/org/x/board-columns"), ctx);
}

async function addColumn(name: string, ctx: typeof ownerCtx | typeof memberCtx = ownerCtx) {
  return handleAddColumn(
    new NextRequest("http://localhost:3000/api/org/x/board-columns", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    ctx,
  );
}

describe("org board-columns API", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe("GET /api/org/[orgId]/board-columns", () => {
    it("always returns the builtin Action Items column first", async () => {
      const res = await getColumns();
      const { columns } = await res.json();
      expect(columns).toEqual([{ id: "action-items", name: "Action Items", builtin: true }]);
    });

    it("appends custom columns in position order", async () => {
      await addColumn("In Progress");
      await addColumn("Done");

      const res = await getColumns();
      const { columns } = await res.json();
      expect(columns.map((c: { name: string }) => c.name)).toEqual(["Action Items", "In Progress", "Done"]);
      expect(columns[1].builtin).toBe(false);
    });
  });

  describe("POST /api/org/[orgId]/board-columns", () => {
    it("adds a custom column as the owner", async () => {
      const res = await addColumn("Blocked");
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("Blocked");

      const row = db.prepare("SELECT * FROM org_board_columns WHERE id = ?").get(body.id);
      expect(row).toBeTruthy();
    });

    it("rejects a non-owner with 403", async () => {
      const res = await addColumn("Blocked", memberCtx);
      expect(res.status).toBe(403);
    });

    it("rejects an empty name with 400", async () => {
      const res = await addColumn("   ");
      expect(res.status).toBe(400);
    });
  });
});
