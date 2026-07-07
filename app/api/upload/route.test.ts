import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";

process.env.BCRYPT_ROUNDS = "4";
process.env.AWS_S3_BUCKET = "test-bucket";
process.env.MAX_UPLOAD_BYTES = String(1024 * 1024); // 1MB cap in tests

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

// The upload route nudges the queue worker; keep that inert in route tests.
vi.mock("@/lib/worker", () => ({ nudgeWorker: vi.fn() }));

import { initSchema } from "@/lib/db";
import { registerUser } from "@/lib/auth";
import { getJob } from "@/lib/queue";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { POST as uploadRoute } from "@/app/api/upload/route";

function uploadRequest(opts: {
  cookie?: string;
  file?: { name: string; type: string; bytes: Uint8Array<ArrayBuffer> };
  language?: string;
}): NextRequest {
  const form = new FormData();
  if (opts.file) {
    form.set("file", new File([opts.file.bytes], opts.file.name, { type: opts.file.type }));
  }
  if (opts.language) form.set("language", opts.language);
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    headers: opts.cookie ? { cookie: opts.cookie } : {},
    body: form,
  });
}

const MP3_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);

describe("POST /api/upload", () => {
  let db: Database.Database;
  let cookie: string;
  let userId: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    getDbMock.mockReturnValue(db);
    uploadAudioMock.mockClear().mockResolvedValue(undefined);

    const reg = await registerUser("alice@example.com", "hunter2secret");
    if (!reg.ok) throw new Error("registration failed");
    userId = reg.userId;
    cookie = `${AUTH_COOKIE}=${reg.token}`;
  });

  afterEach(() => {
    db.close();
  });

  it("accepts an audio file, stores it in S3 and enqueues a job (202)", async () => {
    const res = await uploadRoute(
      uploadRequest({ cookie, file: { name: "standup.mp3", type: "audio/mpeg", bytes: MP3_BYTES } }),
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("queued");

    const job = getJob(body.jobId, userId);
    expect(job).toMatchObject({
      status: "queued",
      source: "web_upload",
      filename: "standup.mp3",
      language: "es",
    });
    expect(job!.s3Key).toBe(`uploads/${userId}/${body.jobId}.mp3`);

    expect(uploadAudioMock).toHaveBeenCalledWith(
      job!.s3Key,
      expect.any(Buffer),
      "audio/mpeg",
    );
  });

  it("records the requested language on the job", async () => {
    const res = await uploadRoute(
      uploadRequest({
        cookie,
        file: { name: "standup.mp3", type: "audio/mpeg", bytes: MP3_BYTES },
        language: "en",
      }),
    );
    const body = await res.json();
    expect(getJob(body.jobId)!.language).toBe("en");
  });

  it("accepts a source field for desktop uploads", async () => {
    const form = new FormData();
    form.set("file", new File([MP3_BYTES], "rec.mp3", { type: "audio/mpeg" }));
    form.set("source", "desktop");
    const res = await uploadRoute(
      new NextRequest("http://localhost/api/upload", {
        method: "POST",
        headers: { cookie },
        body: form,
      }),
    );
    const body = await res.json();
    expect(getJob(body.jobId)!.source).toBe("desktop");
  });

  it("accepts Telegram .oga voice notes even without a MIME type", async () => {
    const res = await uploadRoute(
      uploadRequest({ cookie, file: { name: "voice.oga", type: "", bytes: MP3_BYTES } }),
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    const job = getJob(body.jobId, userId)!;
    expect(job.s3Key).toBe(`uploads/${userId}/${body.jobId}.oga`);
    expect(uploadAudioMock).toHaveBeenCalledWith(job.s3Key, expect.any(Buffer), "audio/ogg");
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await uploadRoute(
      uploadRequest({ file: { name: "a.mp3", type: "audio/mpeg", bytes: MP3_BYTES } }),
    );
    expect(res.status).toBe(401);
    expect(uploadAudioMock).not.toHaveBeenCalled();
  });

  it("rejects a missing file with 400", async () => {
    const res = await uploadRoute(uploadRequest({ cookie }));
    expect(res.status).toBe(400);
  });

  it("rejects non-audio files with 400", async () => {
    const res = await uploadRoute(
      uploadRequest({
        cookie,
        file: { name: "notes.pdf", type: "application/pdf", bytes: MP3_BYTES },
      }),
    );
    expect(res.status).toBe(400);
    expect(uploadAudioMock).not.toHaveBeenCalled();
  });

  it("rejects oversized files with 413", async () => {
    const big = new Uint8Array(2 * 1024 * 1024); // 2MB > 1MB test cap
    const res = await uploadRoute(
      uploadRequest({ cookie, file: { name: "huge.mp3", type: "audio/mpeg", bytes: big } }),
    );
    expect(res.status).toBe(413);
    expect(uploadAudioMock).not.toHaveBeenCalled();
  });

  it("does not enqueue a job when the S3 upload fails", async () => {
    uploadAudioMock.mockRejectedValue(new Error("S3 unavailable"));
    const res = await uploadRoute(
      uploadRequest({ cookie, file: { name: "a.mp3", type: "audio/mpeg", bytes: MP3_BYTES } }),
    );
    expect(res.status).toBe(500);
    const jobs = db.prepare("SELECT * FROM jobs").all();
    expect(jobs).toHaveLength(0);
  });
});
