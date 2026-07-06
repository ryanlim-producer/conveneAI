import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";

const TEST_USER_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

const { deleteAudioMock, getPresignedUrlMock } = vi.hoisted(() => ({
  deleteAudioMock: vi.fn().mockResolvedValue(undefined),
  getPresignedUrlMock: vi.fn().mockResolvedValue("https://s3.example.com/presigned"),
}));

vi.mock("@/lib/s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3")>();
  return { ...actual, deleteAudio: deleteAudioMock, getPresignedUrl: getPresignedUrlMock };
});

import { initSchema } from "@/lib/db";
import { handleGetDetail, handleDelete } from "@/app/api/history/[id]/route";
import { GET as getAudioUrl } from "@/app/api/history/[id]/audio/route";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { registerUser } from "@/lib/auth";

process.env.BCRYPT_ROUNDS = "4";

const SEGMENTS = [
  { speaker: 0, start: 0.5, end: 2.0, text: "hola a todos" },
  { speaker: 1, start: 2.5, end: 4.0, text: "buenos días" },
];

const ACTION_ITEMS = [
  { task: "enviar el reporte", assignee: "María", deadline: "viernes", context: "reporte mensual" },
];

function setupTestDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'a@e.com', 'x')").run(
    TEST_USER_ID,
  );
  return db;
}

function insertUser(db: Database.Database): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')").run(
    id,
    `${id}@example.com`,
  );
  return id;
}

function insertRecording(
  db: Database.Database,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const rec = {
    id: randomUUID(),
    user_id: TEST_USER_ID,
    filename: "meeting.mp3",
    source: "desktop",
    duration_seconds: 120,
    speaker_count: 2,
    s3_key: null as string | null,
    transcript_text: "hola a todos buenos días",
    segments_json: JSON.stringify(SEGMENTS),
    action_items_json: JSON.stringify(ACTION_ITEMS),
    speaker_map_json: JSON.stringify({ "Speaker 0": "María", "Speaker 1": "Carlos" }),
    ...overrides,
  };
  db.prepare(
    `INSERT INTO recordings (id, user_id, filename, source, duration_seconds, speaker_count,
       s3_key, transcript_text, segments_json, action_items_json, speaker_map_json)
     VALUES (@id, @user_id, @filename, @source, @duration_seconds, @speaker_count,
       @s3_key, @transcript_text, @segments_json, @action_items_json, @speaker_map_json)`,
  ).run(rec);
  return rec;
}

function mockReq(id: string, method = "GET"): NextRequest {
  return new NextRequest(`http://localhost:3000/api/history/${id}`, { method });
}

function ctx(id: string, userId = TEST_USER_ID) {
  return { user: { userId, email: "a@e.com" }, params: { id } };
}

describe("GET /api/history/[id]", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("returns full recording detail with parsed segments, speakers, and action items", async () => {
    const rec = insertRecording(db);

    const res = await handleGetDetail(mockReq(rec.id), ctx(rec.id));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.id).toBe(rec.id);
    expect(body.filename).toBe("meeting.mp3");
    expect(body.source).toBe("desktop");
    expect(body.durationSeconds).toBe(120);
    expect(body.speakerCount).toBe(2);
    expect(body.fullTranscript).toBe("hola a todos buenos días");
    expect(body.segments).toEqual(SEGMENTS);
    expect(body.actionItems).toEqual(ACTION_ITEMS);
    expect(body.speakers).toEqual([
      { id: "Speaker 0", name: "María" },
      { id: "Speaker 1", name: "Carlos" },
    ]);
  });

  it("returns 404 for unknown recording", async () => {
    const res = await handleGetDetail(mockReq("nope"), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a recording owned by another user", async () => {
    const rec = insertRecording(db, { user_id: insertUser(db) });
    const res = await handleGetDetail(mockReq(rec.id), ctx(rec.id));
    expect(res.status).toBe(404);
  });

  it("handles malformed JSON columns gracefully", async () => {
    const rec = insertRecording(db, {
      segments_json: "{broken",
      action_items_json: null,
      speaker_map_json: "also broken",
    });

    const res = await handleGetDetail(mockReq(rec.id), ctx(rec.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.segments).toEqual([]);
    expect(body.actionItems).toEqual([]);
    expect(body.speakers).toEqual([]);
  });
});

describe("DELETE /api/history/[id]", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
    deleteAudioMock.mockClear().mockResolvedValue(undefined);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("deletes the DB record, its S3 audio, and its chat messages", async () => {
    const rec = insertRecording(db, { s3_key: `uploads/${TEST_USER_ID}/rec.mp3` });
    db.prepare(
      "INSERT INTO chat_messages (id, recording_id, user_id, role, content) VALUES (?, ?, ?, 'user', 'hola')",
    ).run(randomUUID(), rec.id, TEST_USER_ID);

    const res = await handleDelete(mockReq(rec.id, "DELETE"), ctx(rec.id));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(true);

    expect(db.prepare("SELECT * FROM recordings WHERE id = ?").get(rec.id)).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM chat_messages").get()).toEqual({ n: 0 });
    expect(deleteAudioMock).toHaveBeenCalledWith(`uploads/${TEST_USER_ID}/rec.mp3`);
  });

  it("deletes the record even when the S3 delete fails", async () => {
    deleteAudioMock.mockRejectedValue(new Error("S3 down"));
    const rec = insertRecording(db, { s3_key: "uploads/x/y.mp3" });

    const res = await handleDelete(mockReq(rec.id, "DELETE"), ctx(rec.id));
    expect(res.status).toBe(200);
    expect(db.prepare("SELECT * FROM recordings WHERE id = ?").get(rec.id)).toBeUndefined();
  });

  it("returns 404 when deleting an unknown recording", async () => {
    const res = await handleDelete(mockReq("nope", "DELETE"), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("cannot delete another user's recording", async () => {
    const rec = insertRecording(db, { user_id: insertUser(db) });
    const res = await handleDelete(mockReq(rec.id, "DELETE"), ctx(rec.id));
    expect(res.status).toBe(404);

    expect(db.prepare("SELECT * FROM recordings WHERE id = ?").get(rec.id)).toBeDefined();
  });
});

describe("GET /api/history/[id]/audio", () => {
  let db: Database.Database;
  let cookie: string;
  let userId: string;

  beforeEach(async () => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
    getPresignedUrlMock.mockClear().mockResolvedValue("https://s3.example.com/presigned");
    const reg = await registerUser("audio-tester@example.com", "hunter2secret");
    if (!reg.ok) throw new Error("registration failed");
    userId = reg.userId;
    cookie = `${AUTH_COOKIE}=${reg.token}`;
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  function get(recId: string) {
    return getAudioUrl(
      new NextRequest(`http://localhost/api/history/${recId}/audio`, {
        headers: { cookie },
      }),
      { params: Promise.resolve({ id: recId }) },
    );
  }

  it("returns a presigned playback URL for the recording's audio", async () => {
    const rec = insertRecording(db, { user_id: userId, s3_key: `uploads/${userId}/a.mp3` });

    const res = await get(rec.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://s3.example.com/presigned",
      expiresIn: 3600,
    });
    expect(getPresignedUrlMock).toHaveBeenCalledWith(`uploads/${userId}/a.mp3`, 3600);
  });

  it("returns 404 when the recording has no stored audio", async () => {
    const rec = insertRecording(db, { user_id: userId, s3_key: null });
    expect((await get(rec.id)).status).toBe(404);
  });

  it("returns 404 for another user's recording", async () => {
    const rec = insertRecording(db); // owned by TEST_USER_ID
    expect((await get(rec.id)).status).toBe(404);
  });
});
