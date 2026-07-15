import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

process.env.BCRYPT_ROUNDS = "4";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

vi.mock("@/lib/s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/s3")>();
  return { ...actual, deleteAudio: vi.fn(), getPresignedUrl: vi.fn() };
});

vi.mock("@/lib/worker", () => ({ nudgeWorker: vi.fn() }));

import { initSchema } from "@/lib/db";
import { registerUser } from "@/lib/auth";
import { enqueueJob, getJob } from "@/lib/queue";
import { AUTH_COOKIE } from "@/lib/with-auth";
import { PATCH as patchRecording } from "@/app/api/history/[id]/route";
import { PUT as putActions } from "@/app/api/history/[id]/actions/route";
import { GET as exportAll } from "@/app/api/export/route";
import { PATCH as patchJob } from "@/app/api/queue/[id]/route";

describe("recording management", () => {
  let db: Database.Database;
  let cookie: string;
  let userId: string;

  function insertRecording(owner = userId, overrides: Record<string, unknown> = {}): string {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO recordings (id, user_id, filename, source, duration_seconds, speaker_count,
         transcript_text, action_items_json, speaker_map_json)
       VALUES (?, ?, ?, 'desktop', 60, 1, 'hello world transcript', ?, '{}')`,
    ).run(
      id,
      owner,
      (overrides.filename as string) ?? "meeting.mp3",
      (overrides.action_items_json as string) ?? "[]",
    );
    return id;
  }

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

  function req(url: string, method: string, body?: unknown) {
    return new NextRequest(`http://localhost${url}`, {
      method,
      headers: { "content-type": "application/json", cookie },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  describe("PATCH /api/history/[id] (rename + group)", () => {
    it("renames a recording", async () => {
      const id = insertRecording();
      const res = await patchRecording(req(`/api/history/${id}`, "PATCH", { filename: "Q3 planning" }), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(200);
      const row = db.prepare("SELECT filename FROM recordings WHERE id = ?").get(id) as { filename: string };
      expect(row.filename).toBe("Q3 planning");
    });

    it("assigns and clears a group", async () => {
      const id = insertRecording();
      await patchRecording(req(`/api/history/${id}`, "PATCH", { group: "Client X" }), {
        params: Promise.resolve({ id }),
      });
      expect(
        (db.prepare("SELECT group_name FROM recordings WHERE id = ?").get(id) as { group_name: string })
          .group_name,
      ).toBe("Client X");

      await patchRecording(req(`/api/history/${id}`, "PATCH", { group: null }), {
        params: Promise.resolve({ id }),
      });
      expect(
        (db.prepare("SELECT group_name FROM recordings WHERE id = ?").get(id) as { group_name: string | null })
          .group_name,
      ).toBeNull();
    });

    it("rejects an empty filename", async () => {
      const id = insertRecording();
      const res = await patchRecording(req(`/api/history/${id}`, "PATCH", { filename: "   " }), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(400);
    });

    it("404s for another user's recording", async () => {
      const other = await registerUser("bob@example.com", "hunter2secret");
      if (!other.ok) throw new Error("reg failed");
      const id = insertRecording(other.userId);
      const res = await patchRecording(req(`/api/history/${id}`, "PATCH", { filename: "hijack" }), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /api/history/[id]/actions (edit action items)", () => {
    it("replaces the action items", async () => {
      const id = insertRecording();
      const items = [
        { task: "Send report", assignee: "Mark", deadline: "Friday", context: "" },
        { task: "Book room", assignee: "", deadline: "", context: "offsite" },
      ];
      const res = await putActions(req(`/api/history/${id}/actions`, "PUT", { actionItems: items }), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(200);
      expect((await res.json()).actionItems).toHaveLength(2);

      const stored = JSON.parse(
        (db.prepare("SELECT action_items_json FROM recordings WHERE id = ?").get(id) as { action_items_json: string })
          .action_items_json,
      );
      expect(stored[0].task).toBe("Send report");
    });

    it("allows clearing all items with an empty array", async () => {
      const id = insertRecording(userId, { action_items_json: '[{"task":"old"}]' });
      const res = await putActions(req(`/api/history/${id}/actions`, "PUT", { actionItems: [] }), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(200);
    });

    it("rejects items without a task", async () => {
      const id = insertRecording();
      const res = await putActions(
        req(`/api/history/${id}/actions`, "PUT", { actionItems: [{ assignee: "x" }] }),
        { params: Promise.resolve({ id }) },
      );
      expect(res.status).toBe(400);
    });

    it("404s for another user's recording", async () => {
      const other = await registerUser("bob@example.com", "hunter2secret");
      if (!other.ok) throw new Error("reg failed");
      const id = insertRecording(other.userId);
      const res = await putActions(req(`/api/history/${id}/actions`, "PUT", { actionItems: [] }), {
        params: Promise.resolve({ id }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/export", () => {
    it("exports all of the user's recordings with transcripts and action items", async () => {
      insertRecording(userId, {
        filename: "one.mp3",
        action_items_json: '[{"task":"Do the thing","assignee":"Ana","deadline":"","context":""}]',
      });
      insertRecording(userId, { filename: "two.mp3" });
      const other = await registerUser("bob@example.com", "hunter2secret");
      if (!other.ok) throw new Error("reg failed");
      insertRecording(other.userId, { filename: "not-mine.mp3" });

      const res = await exportAll(new NextRequest("http://localhost/api/export", { headers: { cookie } }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-disposition")).toContain("attachment");

      const body = await res.json();
      expect(body.recordings).toHaveLength(2);
      const one = body.recordings.find((r: { filename: string }) => r.filename === "one.mp3");
      expect(one.fullTranscript).toBe("hello world transcript");
      expect(one.actionItems[0].task).toBe("Do the thing");
      expect(body.exportedAt).toBeTruthy();
    });

    it("requires authentication", async () => {
      const res = await exportAll(new NextRequest("http://localhost/api/export"));
      expect(res.status).toBe(401);
    });
  });

  describe("PATCH /api/queue/[id] (rename while processing)", () => {
    it("renames the job, and the linked recording when it exists", async () => {
      const job = enqueueJob({ userId, filename: "conveneai-123.mp3", s3Key: "k", source: "desktop" });
      const recId = insertRecording(userId, { filename: "conveneai-123.mp3" });
      db.prepare("UPDATE jobs SET recording_id = ? WHERE id = ?").run(recId, job.id);

      const res = await patchJob(req(`/api/queue/${job.id}`, "PATCH", { filename: "Standup with team" }), {
        params: Promise.resolve({ id: job.id }),
      });
      expect(res.status).toBe(200);
      expect(getJob(job.id)!.filename).toBe("Standup with team");
      expect(
        (db.prepare("SELECT filename FROM recordings WHERE id = ?").get(recId) as { filename: string }).filename,
      ).toBe("Standup with team");
    });

    it("404s for another user's job", async () => {
      const other = await registerUser("bob@example.com", "hunter2secret");
      if (!other.ok) throw new Error("reg failed");
      const job = enqueueJob({ userId: other.userId, filename: "x.mp3", s3Key: "k", source: "desktop" });
      const res = await patchJob(req(`/api/queue/${job.id}`, "PATCH", { filename: "steal" }), {
        params: Promise.resolve({ id: job.id }),
      });
      expect(res.status).toBe(404);
    });
  });
});
