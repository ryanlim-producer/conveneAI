import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { encrypt } from "@/lib/crypto";

process.env.ENCRYPTION_KEY = "a".repeat(64);

const TEST_USER_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock, newId: vi.fn(() => randomUUID()) };
});

import { initSchema } from "@/lib/db";

import { handleGetKeys } from "@/app/api/keys/route";

function mockNextRequest() {
  return {} as any;
}

function mockCtx(userId: string = TEST_USER_ID) {
  return { user: { userId, email: "k@e.com" } };
}

function setupTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'k@e.com', 'x')").run(TEST_USER_ID);
  return db;
}

describe("GET /api/keys", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns masked keys for the session", async () => {
    const dgKey = "dg-this-is-a-very-long-key-12345";
    const vckKey = "vck_another-long-secret-key-abcde";
    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), TEST_USER_ID, "deepgram", encrypt(dgKey));
    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), TEST_USER_ID, "vercel-ai-gateway", encrypt(vckKey));

    const response = await handleGetKeys(mockNextRequest(), mockCtx());

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.keys.deepgram).toBe("dg-t***2345");
    expect(body.keys["vercel-ai-gateway"]).toBe("vck_***bcde");
  });

  it("returns first 4 + *** + last 4 even for short keys", async () => {
    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), TEST_USER_ID, "deepgram", encrypt("12345678"));

    const response = await handleGetKeys(mockNextRequest(), mockCtx());
    const body = await response.json();
    expect(body.keys.deepgram).toBe("1234***5678");
  });

  it("never returns plaintext keys", async () => {
    const dgKey = "dg-super-secret-key-do-not-leak";
    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), TEST_USER_ID, "deepgram", encrypt(dgKey));

    const response = await handleGetKeys(mockNextRequest(), mockCtx());
    const body = await response.json();

    const responseStr = JSON.stringify(body);
    expect(responseStr).not.toContain(dgKey);
    expect(responseStr).not.toContain("super-secret");
  });

  it("returns empty keys object when no keys are stored", async () => {
    const response = await handleGetKeys(mockNextRequest(), mockCtx());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.keys).toEqual({});
  });

  it("returns only the keys for the current user, not others", async () => {
    const otherUserId = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'other@e.com', 'x')").run(
      otherUserId,
    );

    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), otherUserId, "deepgram", encrypt("other-session-key"));

    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), TEST_USER_ID, "deepgram", encrypt("my-session-key"));

    const response = await handleGetKeys(mockNextRequest(), mockCtx());
    const body = await response.json();

    expect(body.keys.deepgram).toBeDefined();
    expect(body.keys.deepgram).not.toContain("other-session-key");
  });
});
