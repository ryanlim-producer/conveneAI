import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";

process.env.BCRYPT_ROUNDS = "4";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { registerUser } from "@/lib/auth";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { GET as getSettings, PUT as putSettings } from "@/app/api/settings/route";

function getRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/settings", {
    headers: cookie ? { cookie } : {},
  });
}

function putRequest(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
}

describe("/api/settings", () => {
  let db: Database.Database;
  let cookie: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    getDbMock.mockReturnValue(db);
    const reg = await registerUser("alice@example.com", "hunter2secret");
    if (!reg.ok) throw new Error("registration failed");
    cookie = `${AUTH_COOKIE}=${reg.token}`;
  });

  afterEach(() => {
    db.close();
  });

  it("returns recommended defaults for a fresh user", async () => {
    const res = await getSettings(getRequest(cookie));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deepgramModel: "nova-3",
      actionsLlmModel: "deepseek/deepseek-r1",
      chatbotLlmModel: "deepseek/deepseek-r1",
    });
  });

  it("persists updated model choices", async () => {
    const put = await putSettings(
      putRequest({ deepgramModel: "nova-2-meeting", chatbotLlmModel: "openai/gpt-4o" }, cookie),
    );
    expect(put.status).toBe(200);

    const res = await getSettings(getRequest(cookie));
    expect(await res.json()).toEqual({
      deepgramModel: "nova-2-meeting",
      actionsLlmModel: "deepseek/deepseek-r1",
      chatbotLlmModel: "openai/gpt-4o",
    });
  });

  it("rejects an unknown deepgram model with 400", async () => {
    const res = await putSettings(putRequest({ deepgramModel: "nova-99" }, cookie));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown LLM model with 400", async () => {
    const res = await putSettings(putRequest({ actionsLlmModel: "closedai/gpt-9" }, cookie));
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await getSettings(getRequest())).status).toBe(401);
    expect((await putSettings(putRequest({ deepgramModel: "nova-2" }))).status).toBe(401);
  });
});
