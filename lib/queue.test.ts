import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "crypto";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import {
  enqueueJob,
  getJob,
  listJobs,
  updateJob,
  processNextQueuedJob,
  type Job,
} from "@/lib/queue";

function insertUser(db: Database.Database): string {
  const id = randomUUID();
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)").run(
    id,
    `${id}@example.com`,
    "x",
  );
  return id;
}

describe("job queue", () => {
  let db: Database.Database;
  let userId: string;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    getDbMock.mockReturnValue(db);
    userId = insertUser(db);
  });

  afterEach(() => {
    db.close();
  });

  it("an enqueued job is queued and visible to its owner", () => {
    const job = enqueueJob({
      userId,
      filename: "meeting.mp3",
      s3Key: `uploads/${userId}/abc.mp3`,
      source: "web_upload",
    });

    expect(job.status).toBe("queued");
    expect(job.language).toBe("es"); // default

    const jobs = listJobs(userId);
    expect(jobs.map((j) => j.id)).toContain(job.id);
    expect(getJob(job.id, userId)?.filename).toBe("meeting.mp3");
  });

  it("jobs are not visible to other users", () => {
    const otherUser = insertUser(db);
    const job = enqueueJob({
      userId,
      filename: "meeting.mp3",
      s3Key: "k",
      source: "desktop",
    });

    expect(listJobs(otherUser)).toHaveLength(0);
    expect(getJob(job.id, otherUser)).toBeNull();
  });

  it("processes the oldest queued job first", async () => {
    const first = enqueueJob({ userId, filename: "a.mp3", s3Key: "a", source: "desktop" });
    db.prepare("UPDATE jobs SET created_at = datetime('now', '-1 minute') WHERE id = ?").run(first.id);
    enqueueJob({ userId, filename: "b.mp3", s3Key: "b", source: "desktop" });

    const seen: string[] = [];
    const processed = await processNextQueuedJob(async (job: Job) => {
      seen.push(job.filename);
      updateJob(job.id, { status: "done" });
    });

    expect(processed).toBe(true);
    expect(seen).toEqual(["a.mp3"]);
    expect(getJob(first.id)?.status).toBe("done");
  });

  it("returns false when there is nothing queued", async () => {
    const processed = await processNextQueuedJob(async () => {});
    expect(processed).toBe(false);
  });

  it("requeues a job after its first failure", async () => {
    const job = enqueueJob({ userId, filename: "a.mp3", s3Key: "a", source: "desktop" });

    await processNextQueuedJob(async () => {
      throw new Error("Deepgram exploded");
    });

    const after = getJob(job.id)!;
    expect(after.status).toBe("queued");
    expect(after.attempts).toBe(1);
  });

  it("marks a job as error with a message after its second failure", async () => {
    const job = enqueueJob({ userId, filename: "a.mp3", s3Key: "a", source: "desktop" });

    for (let i = 0; i < 2; i++) {
      await processNextQueuedJob(async () => {
        throw new Error("Deepgram exploded");
      });
    }

    const after = getJob(job.id)!;
    expect(after.status).toBe("error");
    expect(after.errorMessage).toContain("Deepgram exploded");
    expect(after.attempts).toBe(2);
    expect(after.completedAt).toBeTruthy();
  });

  it("an errored job is not picked up again", async () => {
    enqueueJob({ userId, filename: "a.mp3", s3Key: "a", source: "desktop" });
    for (let i = 0; i < 2; i++) {
      await processNextQueuedJob(async () => {
        throw new Error("boom");
      });
    }

    const processed = await processNextQueuedJob(async () => {});
    expect(processed).toBe(false);
  });

  it("updateJob transitions status and records fields", () => {
    const job = enqueueJob({ userId, filename: "a.mp3", s3Key: "a", source: "telegram" });

    updateJob(job.id, { status: "transcribing", modelUsed: "nova-3" });
    expect(getJob(job.id)).toMatchObject({ status: "transcribing", modelUsed: "nova-3" });

    const recId = randomUUID();
    db.prepare(
      "INSERT INTO recordings (id, user_id, filename, source) VALUES (?, ?, 'a.mp3', 'telegram')",
    ).run(recId, userId);
    updateJob(job.id, { status: "done", recordingId: recId });
    const done = getJob(job.id)!;
    expect(done.status).toBe("done");
    expect(done.recordingId).toBe(recId);
    expect(done.completedAt).toBeTruthy();
  });
});
