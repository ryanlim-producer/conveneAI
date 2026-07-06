import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { encrypt, decrypt } from "@/lib/crypto";

process.env.ENCRYPTION_KEY = "a".repeat(64);

const TEST_USER_ID = randomUUID();

const { getDbMock, newIdMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  newIdMock: vi.fn(() => randomUUID()),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock, newId: newIdMock };
});

import { initSchema } from "@/lib/db";

const { validateDeepgramKeyMock, validateVercelAIGatewayKeyMock } = vi.hoisted(() => ({
  validateDeepgramKeyMock: vi.fn().mockResolvedValue({ valid: true }),
  validateVercelAIGatewayKeyMock: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock("@/lib/key-validation", () => ({
  validateDeepgramKey: validateDeepgramKeyMock,
  validateVercelAIGatewayKey: validateVercelAIGatewayKeyMock,
}));

import { handlePostKey } from "@/app/api/keys/route";

function mockNextRequest(body: unknown) {
  return { json: async () => body } as any;
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

describe("POST /api/keys", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
    newIdMock.mockImplementation(() => randomUUID());
    validateDeepgramKeyMock.mockResolvedValue({ valid: true });
    validateVercelAIGatewayKeyMock.mockResolvedValue({ valid: true });
  });

  afterEach(() => {
    db.close();
  });

  it("stores an encrypted deepgram key scoped to session", async () => {
    const apiKey = "dg-test-key-12345";
    const response = await handlePostKey(mockNextRequest({
      provider: "deepgram",
      key: apiKey,
    }), mockCtx());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const row = db
      .prepare("SELECT * FROM api_keys WHERE user_id = ? AND provider = ?")
      .get(TEST_USER_ID, "deepgram") as any;
    expect(row).toBeTruthy();
    expect(row.encrypted_key).not.toBe(apiKey);
    expect(row.encrypted_key).toContain(":");
    expect(decrypt(row.encrypted_key)).toBe(apiKey);
  });

  it("stores an encrypted vercel-ai-gateway key scoped to session", async () => {
    const apiKey = "vck_test-key-12345";
    const response = await handlePostKey(mockNextRequest({
      provider: "vercel-ai-gateway",
      key: apiKey,
    }), mockCtx());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const row = db
      .prepare("SELECT * FROM api_keys WHERE user_id = ? AND provider = ?")
      .get(TEST_USER_ID, "vercel-ai-gateway") as any;
    expect(row).toBeTruthy();
    expect(decrypt(row.encrypted_key)).toBe(apiKey);
  });

  it("rejects missing provider field", async () => {
    const response = await handlePostKey(mockNextRequest({
      key: "some-key",
    }), mockCtx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("provider");
  });

  it("rejects missing key field", async () => {
    const response = await handlePostKey(mockNextRequest({
      provider: "deepgram",
    }), mockCtx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("key");
  });

  it("rejects invalid provider value", async () => {
    const response = await handlePostKey(mockNextRequest({
      provider: "openai",
      key: "sk-test",
    }), mockCtx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("provider");
  });

  it("rejects empty key string", async () => {
    const response = await handlePostKey(mockNextRequest({
      provider: "deepgram",
      key: "",
    }), mockCtx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("key");
  });

  it("upserts when a key for the same provider already exists", async () => {
    await handlePostKey(mockNextRequest({
      provider: "deepgram",
      key: "old-key",
    }), mockCtx());

    await handlePostKey(mockNextRequest({
      provider: "deepgram",
      key: "new-key",
    }), mockCtx());

    const rows = db
      .prepare("SELECT * FROM api_keys WHERE user_id = ? AND provider = ?")
      .all(TEST_USER_ID, "deepgram") as any[];
    expect(rows.length).toBe(1);
    expect(decrypt(rows[0].encrypted_key)).toBe("new-key");
  });

  it("allows different providers for the same session", async () => {
    await handlePostKey(mockNextRequest({
      provider: "deepgram",
      key: "dg-key",
    }), mockCtx());

    await handlePostKey(mockNextRequest({
      provider: "vercel-ai-gateway",
      key: "vck-key",
    }), mockCtx());

    const rows = db
      .prepare("SELECT * FROM api_keys WHERE user_id = ?")
      .all(TEST_USER_ID) as any[];
    expect(rows.length).toBe(2);
  });

  it("validates deepgram key against Deepgram API before storing", async () => {
    validateDeepgramKeyMock.mockResolvedValue({ valid: true });

    const response = await handlePostKey(mockNextRequest({
      provider: "deepgram",
      key: "dg-validated-key",
    }), mockCtx());

    expect(validateDeepgramKeyMock).toHaveBeenCalledWith("dg-validated-key");
    expect(response.status).toBe(200);
  });

  it("rejects deepgram key that fails validation with error message", async () => {
    validateDeepgramKeyMock.mockResolvedValue({
      valid: false,
      error: "Invalid Deepgram API key. Please check your key and try again.",
    });

    const response = await handlePostKey(mockNextRequest({
      provider: "deepgram",
      key: "dg-bad-key",
    }), mockCtx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Invalid Deepgram");

    const row = db
      .prepare("SELECT * FROM api_keys WHERE user_id = ? AND provider = ?")
      .get(TEST_USER_ID, "deepgram");
    expect(row).toBeUndefined();
  });

  it("validates vercel-ai-gateway key against Vercel AI Gateway before storing", async () => {
    validateVercelAIGatewayKeyMock.mockResolvedValue({ valid: true });

    const response = await handlePostKey(mockNextRequest({
      provider: "vercel-ai-gateway",
      key: "vck_validated-key",
    }), mockCtx());

    expect(validateVercelAIGatewayKeyMock).toHaveBeenCalledWith("vck_validated-key");
    expect(response.status).toBe(200);
  });

  it("rejects vercel-ai-gateway key that fails validation with error message", async () => {
    validateVercelAIGatewayKeyMock.mockResolvedValue({
      valid: false,
      error: "Invalid Vercel AI Gateway key. Please check your key and try again.",
    });

    const response = await handlePostKey(mockNextRequest({
      provider: "vercel-ai-gateway",
      key: "vck_bad-key",
    }), mockCtx());

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Invalid Vercel");

    const row = db
      .prepare("SELECT * FROM api_keys WHERE user_id = ? AND provider = ?")
      .get(TEST_USER_ID, "vercel-ai-gateway");
    expect(row).toBeUndefined();
  });
});
