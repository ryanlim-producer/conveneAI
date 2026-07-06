import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { encrypt } from "@/lib/crypto";

process.env.ENCRYPTION_KEY = "a".repeat(64);

const TEST_SESSION_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: getDbMock,
  newId: vi.fn(() => randomUUID()),
  closeDb: vi.fn(),
}));

import { callLLM } from "@/lib/llm-client";

function setupTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('deepgram', 'vercel-ai-gateway')),
      encrypted_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe("callLLM", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    db.close();
  });

  it("calls Vercel AI Gateway with session key and returns response text", async () => {
    // Store a Vercel key
    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), TEST_SESSION_ID, "vercel-ai-gateway", encrypt("vck_test-key"));

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Hello from LLM" } }],
        }),
        { status: 200 },
      ),
    );

    const result = await callLLM(TEST_SESSION_ID, {
      model: "deepseek/deepseek-r1",
      messages: [{ role: "user", content: "Say hello" }],
    });

    expect(result).toBe("Hello from LLM");
  });

  it("sends correct request shape to Vercel AI Gateway", async () => {
    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), TEST_SESSION_ID, "vercel-ai-gateway", encrypt("vck_test-key"));

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "OK" } }],
        }),
        { status: 200 },
      ),
    );

    await callLLM(TEST_SESSION_ID, {
      model: "deepseek/deepseek-r1",
      messages: [{ role: "user", content: "Test" }],
      temperature: 0.3,
      max_tokens: 1000,
    });

    const url = fetchSpy.mock.calls[0][0] as string;
    const options = fetchSpy.mock.calls[0][1] as any;
    const body = JSON.parse(options.body);

    expect(url).toBe("https://ai-gateway.vercel.sh/v1/chat/completions");
    expect(options.headers["Authorization"]).toBe("Bearer vck_test-key");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(body.model).toBe("deepseek/deepseek-r1");
    expect(body.messages).toEqual([{ role: "user", content: "Test" }]);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(1000);
  });

  it("throws when no Vercel AI Gateway key is configured for session", async () => {
    await expect(
      callLLM(TEST_SESSION_ID, {
        model: "deepseek/deepseek-r1",
        messages: [{ role: "user", content: "Test" }],
      }),
    ).rejects.toThrow("Vercel AI Gateway key");
  });

  it("falls back to secondary model on 429", async () => {
    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), TEST_SESSION_ID, "vercel-ai-gateway", encrypt("vck_test-key"));

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // First call: 429
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 }),
    );
    // Second call with fallback: 200
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "Fallback response" } }],
        }),
        { status: 200 },
      ),
    );

    const result = await callLLM(TEST_SESSION_ID, {
      model: "deepseek/deepseek-r1",
      messages: [{ role: "user", content: "Test" }],
    });

    expect(result).toBe("Fallback response");

    // Second call should use fallback model
    const secondBody = JSON.parse(String(fetchSpy.mock.calls[1]![1]!.body));
    expect(secondBody.model).toBe("deepseek/deepseek-chat");
  });

  it("throws when both primary and fallback fail", async () => {
    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), TEST_SESSION_ID, "vercel-ai-gateway", encrypt("vck_test-key"));

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Rate limited" }), { status: 429 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Server error" }), { status: 500 }),
      );

    await expect(
      callLLM(TEST_SESSION_ID, {
        model: "deepseek/deepseek-r1",
        messages: [{ role: "user", content: "Test" }],
      }),
    ).rejects.toThrow("LLM call failed");
  });
});
