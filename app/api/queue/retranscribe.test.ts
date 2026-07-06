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

vi.mock("@/lib/worker", () => ({ nudgeWorker: vi.fn() }));

import { initSchema } from "@/lib/db";
import { registerUser } from "@/lib/auth";
import { enqueueJob, getJob, updateJob } from "@/lib/queue";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { POST as retranscribe } from "@/app/api/queue/[id]/retranscribe/route";

function postRequest(jobId: string, cookie?: string) {
  const req = new NextRequest(`http://localhost/api/queue/${jobId}/retranscribe`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
  return retranscribe(req, { params: Promise.resolve({ id: jobId }) });
}

describe("POST /api/queue/[id]/retranscribe", () => {
  let db: Database.Database;
  let cookie: string;
  let userId: string;

  beforeEach(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    getDbMock.mockReturnValue(db);
    const reg = await registerUser("alice@example.com", "hunter2secret");
    if (!reg.ok) throw new Error("registration failed");
    userId = reg.userId;
    cookie = `${AUTH_COOKIE}=${reg.token}`;
  });

  afterEach(() => {
    db.close();
  });

  function completedJob() {
    const job = enqueueJob({
      userId,
      filename: "meeting.mp3",
      s3Key: `uploads/${userId}/orig.mp3`,
      source: "desktop",
      language: "en",
    });
    db.prepare(
      "INSERT INTO recordings (id, user_id, job_id, filename, source) VALUES ('rec-1', ?, ?, 'meeting.mp3', 'desktop')",
    ).run(userId, job.id);
    updateJob(job.id, { status: "done", recordingId: "rec-1" });
    return getJob(job.id)!;
  }

  it("queues a new job on the same audio, preserving the original job and recording", async () => {
    const original = completedJob();

    const res = await postRequest(original.id, cookie);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("queued");
    expect(body.jobId).not.toBe(original.id);

    const fresh = getJob(body.jobId)!;
    expect(fresh.s3Key).toBe(original.s3Key);
    expect(fresh.language).toBe("en");
    expect(fresh.source).toBe(original.source);

    // original untouched
    expect(getJob(original.id)!.status).toBe("done");
    expect(db.prepare("SELECT COUNT(*) AS n FROM recordings").get()).toEqual({ n: 1 });
  });

  it("also works for errored jobs", async () => {
    const job = enqueueJob({ userId, filename: "a.mp3", s3Key: "k", source: "web_upload" });
    updateJob(job.id, { status: "error", errorMessage: "boom" });

    const res = await postRequest(job.id, cookie);
    expect(res.status).toBe(202);
  });

  it("returns 409 while the original is still processing", async () => {
    const job = enqueueJob({ userId, filename: "a.mp3", s3Key: "k", source: "web_upload" });
    updateJob(job.id, { status: "transcribing" });

    const res = await postRequest(job.id, cookie);
    expect(res.status).toBe(409);
  });

  it("returns 404 for another user's job", async () => {
    const other = await registerUser("bob@example.com", "hunter2secret");
    if (!other.ok) throw new Error("registration failed");
    const otherJob = enqueueJob({
      userId: other.userId,
      filename: "b.mp3",
      s3Key: "k2",
      source: "desktop",
    });
    updateJob(otherJob.id, { status: "done" });

    const res = await postRequest(otherJob.id, cookie);
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const original = completedJob();
    const res = await postRequest(original.id);
    expect(res.status).toBe(401);
  });
});
