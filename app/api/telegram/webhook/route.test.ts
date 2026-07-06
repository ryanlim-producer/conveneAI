import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

process.env.TELEGRAM_BOT_TOKEN = "test-bot-token-12345";
process.env.AWS_S3_BUCKET = "test-bucket";

const { downloadTelegramAudioMock } = vi.hoisted(() => ({
  downloadTelegramAudioMock: vi.fn(),
}));

vi.mock("@/lib/telegram-audio", () => ({
  downloadTelegramAudio: downloadTelegramAudioMock,
}));

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

const { uploadAudioMock } = vi.hoisted(() => ({
  uploadAudioMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3")>();
  return { ...actual, uploadAudio: uploadAudioMock };
});

vi.mock("@/lib/worker", () => ({ nudgeWorker: vi.fn() }));

import { initSchema } from "@/lib/db";
import { POST } from "@/app/api/telegram/webhook/route";

function mockNextRequest(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: new Map(Object.entries(headers)),
  } as any;
}

const VALID_HEADER = { "x-telegram-bot-api-secret-token": "test-bot-token-12345" };

function audioUpdate(chatId = 456789, telegramUserId = 12345) {
  return {
    update_id: 2,
    message: {
      message_id: 2,
      voice: { file_id: "audio-123", duration: 30, mime_type: "audio/ogg" },
      chat: { id: chatId },
      from: { id: telegramUserId },
    },
  };
}

/** Waits for fire-and-forget async handlers to settle. */
const flush = (ms = 150) => new Promise((r) => setTimeout(r, ms));

/** Polls until the predicate holds (fire-and-forget handlers do lazy imports). */
async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("POST /api/telegram/webhook", () => {
  let db: Database.Database;
  let sentMessages: string[];

  function insertUser(): string {
    const id = randomUUID();
    db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
      id,
      `${id}@example.com`,
      "x",
    );
    return id;
  }

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    getDbMock.mockReturnValue(db);
    uploadAudioMock.mockClear().mockResolvedValue(undefined);
    downloadTelegramAudioMock.mockReset().mockResolvedValue({
      buffer: Buffer.from("fake-audio"),
      filename: "voice.ogg",
    });

    sentMessages = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("api.telegram.org")) {
        if (init?.body) sentMessages.push(JSON.parse(String(init.body)).text ?? "");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  it("returns 401 when secret token header is missing or wrong", async () => {
    expect((await POST(mockNextRequest({ update_id: 1 }))).status).toBe(401);
    expect(
      (
        await POST(
          mockNextRequest({ update_id: 1 }, { "x-telegram-bot-api-secret-token": "wrong" }),
        )
      ).status,
    ).toBe(401);
  });

  it("enqueues audio from a linked user as a telegram job owned by that user", async () => {
    const userId = insertUser();
    db.prepare(
      "INSERT INTO telegram_links (id, user_id, telegram_user_id, telegram_chat_id) VALUES (?, ?, 12345, 456789)",
    ).run(randomUUID(), userId);

    const res = await POST(mockNextRequest(audioUpdate(), VALID_HEADER));
    expect(res.status).toBe(200);
    await waitFor(() => !!db.prepare("SELECT COUNT(*) AS n FROM jobs").get()!["n" as never]);

    const job = db.prepare("SELECT * FROM jobs").get() as Record<string, unknown>;
    expect(job).toBeTruthy();
    expect(job.user_id).toBe(userId);
    expect(job.source).toBe("telegram");
    expect(job.status).toBe("queued");
    expect(job.filename).toBe("voice.ogg");
    expect(uploadAudioMock).toHaveBeenCalled();
    // user is told the audio is queued
    expect(sentMessages.some((m) => /procesando|queued|cola/i.test(m))).toBe(true);
  });

  it("falls back to the first user with a Deepgram key for unlinked senders", async () => {
    const userId = insertUser();
    db.prepare(
      "INSERT INTO api_keys (id, user_id, provider, encrypted_key) VALUES (?, ?, 'deepgram', 'enc')",
    ).run(randomUUID(), userId);

    await POST(mockNextRequest(audioUpdate(999, 999), VALID_HEADER));
    await waitFor(() => !!db.prepare("SELECT COUNT(*) AS n FROM jobs").get()!["n" as never]);

    const job = db.prepare("SELECT * FROM jobs").get() as Record<string, unknown>;
    expect(job.user_id).toBe(userId);
  });

  it("tells unlinked senders to link when no account can be resolved", async () => {
    await POST(mockNextRequest(audioUpdate(999, 999), VALID_HEADER));
    await flush();

    expect(db.prepare("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({ n: 0 });
    expect(uploadAudioMock).not.toHaveBeenCalled();
    expect(sentMessages.some((m) => /link/i.test(m))).toBe(true);
  });

  it("links a Telegram account to the user who generated the code", async () => {
    const userId = insertUser();
    db.prepare("INSERT INTO link_codes (code, user_id) VALUES ('ABC123', ?)").run(userId);

    const res = await POST(
      mockNextRequest(
        {
          update_id: 3,
          message: {
            message_id: 3,
            text: "/link ABC123",
            chat: { id: 456789 },
            from: { id: 12345 },
          },
        },
        VALID_HEADER,
      ),
    );
    expect(res.status).toBe(200);

    const link = db.prepare("SELECT * FROM telegram_links").get() as Record<string, unknown>;
    expect(link.user_id).toBe(userId);
    expect(link.telegram_user_id).toBe(12345);
    // code is single-use
    expect(db.prepare("SELECT COUNT(*) AS n FROM link_codes").get()).toEqual({ n: 0 });
  });

  it("rejects an expired or unknown link code", async () => {
    await POST(
      mockNextRequest(
        {
          update_id: 3,
          message: { message_id: 3, text: "/link NOPE99", chat: { id: 1 }, from: { id: 2 } },
        },
        VALID_HEADER,
      ),
    );
    expect(db.prepare("SELECT COUNT(*) AS n FROM telegram_links").get()).toEqual({ n: 0 });
    expect(sentMessages.some((m) => /invalid|expired/i.test(m))).toBe(true);
  });

  it("returns 200 for non-message updates", async () => {
    const res = await POST(mockNextRequest({ update_id: 1, edited_message: {} }, VALID_HEADER));
    expect(res.status).toBe(200);
  });
});
