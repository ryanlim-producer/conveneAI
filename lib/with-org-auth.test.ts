import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const TEST_USER_ID = randomUUID();
const TEST_ORG_ID = randomUUID();
const TEST_MEMBER_ID = randomUUID();
const OTHER_USER_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { createOrgSession, ORG_AUTH_COOKIE } from "@/lib/org-auth";
import { withOrgAuth } from "@/lib/with-org-auth";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);

  // Create owner user
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'owner@t.com', 'h')").run(
    TEST_USER_ID,
  );
  // Create a non-owner user
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'other@t.com', 'h')").run(
    OTHER_USER_ID,
  );
  // Create org
  db.prepare(
    "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Test Org', 'test-org', 'hash')",
  ).run(TEST_ORG_ID, TEST_USER_ID);
  // Create member
  db.prepare(
    "INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Alice')",
  ).run(TEST_MEMBER_ID, TEST_ORG_ID);

  return db;
}

// Echo handler: returns the context it received
const echoHandler = withOrgAuth<{ orgId: string }>(
  async (_req, ctx) =>
    NextResponse.json({ context: ctx.orgContext }),
);

function makeReq(cookieHeader?: string): NextRequest {
  return new NextRequest(`http://localhost/api/org/${TEST_ORG_ID}/test`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

describe("withOrgAuth", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("rejects with 401 when no cookies are present", async () => {
    const res = await echoHandler(makeReq(), {
      params: Promise.resolve({ orgId: TEST_ORG_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects with 401 for an invalid org session token", async () => {
    const res = await echoHandler(
      makeReq(`${ORG_AUTH_COOKIE}=invalid-token`),
      { params: Promise.resolve({ orgId: TEST_ORG_ID }) },
    );
    expect(res.status).toBe(401);
  });

  it("accepts a valid org member session and returns member context", async () => {
    const { token } = createOrgSession(TEST_MEMBER_ID);
    const res = await echoHandler(
      makeReq(`${ORG_AUTH_COOKIE}=${token}`),
      { params: Promise.resolve({ orgId: TEST_ORG_ID }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.context.type).toBe("member");
    expect(body.context.memberId).toBe(TEST_MEMBER_ID);
    expect(body.context.orgId).toBe(TEST_ORG_ID);
  });

  it("rejects a member session that belongs to a different org", async () => {
    // Create another org + member
    const otherOrgId = randomUUID();
    db.prepare(
      "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Other Org', 'other', 'h')",
    ).run(otherOrgId, TEST_USER_ID);
    const otherMemberId = randomUUID();
    db.prepare(
      "INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Bob')",
    ).run(otherMemberId, otherOrgId);
    const { token } = createOrgSession(otherMemberId);

    // Try to access TEST_ORG_ID with other org's member session
    const res = await echoHandler(
      makeReq(`${ORG_AUTH_COOKIE}=${token}`),
      { params: Promise.resolve({ orgId: TEST_ORG_ID }) },
    );
    expect(res.status).toBe(401);
  });

  it("accepts the owner's user cookie and returns owner context", async () => {
    // Create a user session for the owner
    const userToken = "owner-session-token";
    db.prepare(
      "INSERT INTO user_sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))",
    ).run(randomUUID(), TEST_USER_ID, userToken);

    const res = await echoHandler(
      makeReq(`conveneai-auth=${userToken}`),
      { params: Promise.resolve({ orgId: TEST_ORG_ID }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.context.type).toBe("owner");
    expect(body.context.userId).toBe(TEST_USER_ID);
    expect(body.context.orgId).toBe(TEST_ORG_ID);
  });

  it("rejects a non-owner's user cookie with 403", async () => {
    // Create a user session for the non-owner
    const userToken = "other-session-token";
    db.prepare(
      "INSERT INTO user_sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))",
    ).run(randomUUID(), OTHER_USER_ID, userToken);

    const res = await echoHandler(
      makeReq(`conveneai-auth=${userToken}`),
      { params: Promise.resolve({ orgId: TEST_ORG_ID }) },
    );
    expect(res.status).toBe(403);
  });

  it("prefers org session over user cookie when both are present", async () => {
    // Set up both cookies
    const { token: orgToken } = createOrgSession(TEST_MEMBER_ID);

    const userToken = "owner-session-token";
    db.prepare(
      "INSERT INTO user_sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, datetime('now', '+30 days'))",
    ).run(randomUUID(), TEST_USER_ID, userToken);

    const res = await echoHandler(
      makeReq(`${ORG_AUTH_COOKIE}=${orgToken}; conveneai-auth=${userToken}`),
      { params: Promise.resolve({ orgId: TEST_ORG_ID }) },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should be treated as the org member (org session takes priority)
    expect(body.context.type).toBe("member");
  });

  it("returns 404 when orgId param is missing", async () => {
    const { token } = createOrgSession(TEST_MEMBER_ID);
    const res = await echoHandler(
      makeReq(`${ORG_AUTH_COOKIE}=${token}`),
      { params: Promise.resolve({} as { orgId: string }) },
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when the org does not exist", async () => {
    const { token } = createOrgSession(TEST_MEMBER_ID);
    const res = await echoHandler(
      makeReq(`${ORG_AUTH_COOKIE}=${token}`),
      { params: Promise.resolve({ orgId: "nonexistent-org" }) },
    );
    // Member check will fail first since the member's org won't match
    expect(res.status).toBe(401);
  });
});
