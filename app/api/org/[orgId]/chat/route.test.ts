import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";

process.env.BCRYPT_ROUNDS = "4";
process.env.VERCEL_AI_GATEWAY_KEY = "env-gateway-key";

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
import { ORG_AUTH_COOKIE, createOrgSession } from "@/lib/org-auth";
import {
  GET as getChat,
  POST as postChat,
  DELETE as deleteChat,
} from "@/app/api/org/[orgId]/chat/[recordingId]/route";

describe("/api/org/[orgId]/chat/[recordingId]", () => {
  let db: Database.Database;
  let ownerCookie: string;
  let ownerId: string;
  let orgId: string;
  let folderId: string;
  let recordingId: string;

  function insertRecording(owner: string, groupId: string, overrides: Record<string, unknown> = {}): string {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO recordings (id, user_id, group_id, filename, source, duration_seconds, speaker_count,
        transcript_text, segments_json, speaker_map_json, action_items_json)
       VALUES (?, ?, ?, 'standup.mp3', 'desktop', 300, 2, ?, '[]', ?, ?)`,
    ).run(
      id,
      owner,
      groupId,
      (overrides.transcript as string) ?? "Carlos: Hola. María: El presupuesto es 50k.",
      JSON.stringify({ "Speaker 0": "Carlos", "Speaker 1": "María" }),
      JSON.stringify([{ task: "Revisar presupuesto", assignee: "María", deadline: "viernes", context: "" }]),
    );
    return id;
  }

  beforeEach(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    getDbMock.mockReturnValue(db);

    const reg = await registerUser("owner@example.com", "hunter2secret");
    if (!reg.ok) throw new Error("registration failed");
    ownerId = reg.userId;
    ownerCookie = `${AUTH_COOKIE}=${reg.token}`;

    // Create org
    orgId = randomUUID();
    db.prepare("INSERT INTO organizations (id, slug, name, password_hash, user_id) VALUES (?, ?, ?, ?, ?)").run(
      orgId, "test-org", "Test Org", "$2a$04$placeholder", ownerId,
    );

    // Create folder
    folderId = randomUUID();
    db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, ?)").run(folderId, ownerId, "Test Folder");
    db.prepare("INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)").run(orgId, folderId);

    recordingId = insertRecording(ownerId, folderId);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("ai-gateway.vercel.sh")) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "El presupuesto es 50k." } }] }),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
  });

  afterEach(() => {
    db.close();
    vi.restoreAllMocks();
  });

  function post(recId: string, body: unknown, cookie?: string) {
    return postChat(
      new NextRequest(`http://localhost/api/org/${orgId}/chat/${recId}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : { cookie: ownerCookie }),
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ orgId, recordingId: recId }) },
    );
  }

  function get(recId: string, cookie?: string) {
    return getChat(
      new NextRequest(`http://localhost/api/org/${orgId}/chat/${recId}`, {
        headers: cookie ? { cookie } : { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ orgId, recordingId: recId }) },
    );
  }

  function del(recId: string, cookie?: string) {
    return deleteChat(
      new NextRequest(`http://localhost/api/org/${orgId}/chat/${recId}`, {
        method: "DELETE",
        headers: cookie ? { cookie } : { cookie: ownerCookie },
      }),
      { params: Promise.resolve({ orgId, recordingId: recId }) },
    );
  }

  describe("DELETE", () => {
    it("deletes all chat messages for the owner on the recording", async () => {
      await post(recordingId, { message: "Hello" });
      await post(recordingId, { message: "Follow-up" });

      const before = await (await get(recordingId)).json();
      expect(before.messages).toHaveLength(4);

      const res = await del(recordingId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(4);

      const after = await (await get(recordingId)).json();
      expect(after.messages).toHaveLength(0);
    });

    it("returns deleted: 0 when there are no messages", async () => {
      const res = await del(recordingId);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toBe(0);
    });

    it("returns 404 for a recording outside the org", async () => {
      const otherFolder = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, ?)").run(otherFolder, ownerId, "Other");
      const otherRec = insertRecording(ownerId, otherFolder);
      expect((await del(otherRec)).status).toBe(404);
    });

    it("requires authentication", async () => {
      const res = await deleteChat(
        new NextRequest(`http://localhost/api/org/${orgId}/chat/${recordingId}`, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ orgId, recordingId }) },
      );
      expect(res.status).toBe(401);
    });
  });
});
