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
import { enqueueJob } from "@/lib/queue";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { GET as listQueue } from "@/app/api/queue/route";
import { GET as getQueueJob } from "@/app/api/queue/[id]/route";

describe("queue API", () => {
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

  describe("GET /api/queue", () => {
    it("lists only the requesting user's jobs", async () => {
      enqueueJob({ userId, filename: "mine.mp3", s3Key: "k1", source: "desktop" });
      const other = await registerUser("bob@example.com", "hunter2secret");
      if (!other.ok) throw new Error("registration failed");
      enqueueJob({ userId: other.userId, filename: "theirs.mp3", s3Key: "k2", source: "desktop" });

      const res = await listQueue(
        new NextRequest("http://localhost/api/queue", { headers: { cookie } }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.jobs).toHaveLength(1);
      expect(body.jobs[0].filename).toBe("mine.mp3");
    });

    it("requires authentication", async () => {
      const res = await listQueue(new NextRequest("http://localhost/api/queue"));
      expect(res.status).toBe(401);
    });

    it("streams jobs as server-sent events when ?stream=true", async () => {
      enqueueJob({ userId, filename: "mine.mp3", s3Key: "k1", source: "web_upload" });

      const res = await listQueue(
        new NextRequest("http://localhost/api/queue?stream=true", { headers: { cookie } }),
      );

      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const reader = res.body!.getReader();
      const { value } = await reader.read();
      const text = new TextDecoder().decode(value);
      await reader.cancel();

      expect(text).toContain("data: ");
      const payload = JSON.parse(text.replace(/^data: /, "").trim());
      expect(payload.jobs).toHaveLength(1);
      expect(payload.jobs[0].filename).toBe("mine.mp3");
    });
  });

  describe("GET /api/queue/[id]", () => {
    it("returns a single job", async () => {
      const job = enqueueJob({ userId, filename: "a.mp3", s3Key: "k", source: "telegram" });
      const res = await getQueueJob(
        new NextRequest(`http://localhost/api/queue/${job.id}`, { headers: { cookie } }),
        { params: Promise.resolve({ id: job.id }) },
      );
      expect(res.status).toBe(200);
      expect((await res.json()).job).toMatchObject({ id: job.id, status: "queued" });
    });

    it("hides other users' jobs (404)", async () => {
      const other = await registerUser("bob@example.com", "hunter2secret");
      if (!other.ok) throw new Error("registration failed");
      const job = enqueueJob({ userId: other.userId, filename: "b.mp3", s3Key: "k", source: "desktop" });

      const res = await getQueueJob(
        new NextRequest(`http://localhost/api/queue/${job.id}`, { headers: { cookie } }),
        { params: Promise.resolve({ id: job.id }) },
      );
      expect(res.status).toBe(404);
    });
  });
});
