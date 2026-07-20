import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

process.env.BCRYPT_ROUNDS = "4";

const TEST_USER_ID = randomUUID();
const OTHER_USER_ID = randomUUID();

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { handleCreate, handleList } from "@/app/api/organizations/route";
import { handleDelete } from "@/app/api/organizations/[id]/route";

function setupTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initSchema(db);
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'o@t.com', 'h')").run(
    TEST_USER_ID,
  );
  db.prepare("INSERT INTO users (id, email, password_hash) VALUES (?, 'x@t.com', 'h')").run(
    OTHER_USER_ID,
  );
  return db;
}

function ownerCtx() {
  return { user: { userId: TEST_USER_ID, email: "o@t.com" } };
}

function postBody(body: Record<string, unknown>) {
  return handleCreate(
    new NextRequest("http://localhost:3000/api/organizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { user: { userId: TEST_USER_ID, email: "o@t.com" } },
  );
}

function post(name: string, password: string) {
  return postBody({ name, password });
}

describe("organizations API", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe("POST /api/organizations", () => {
    it("creates an organization with auto-generated slug", async () => {
      const res = await post("Design Team", "secret123");
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeTruthy();
      expect(body.name).toBe("Design Team");
      expect(body.slug).toBe("design-team");
      expect(body.createdAt).toBeTruthy();

      // Verify persistence
      const row = db.prepare("SELECT * FROM organizations WHERE id = ?").get(body.id) as {
        name: string;
        slug: string;
        password_hash: string;
        user_id: string;
      };
      expect(row.name).toBe("Design Team");
      expect(row.slug).toBe("design-team");
      expect(row.user_id).toBe(TEST_USER_ID);

      // Password should be hashed
      expect(row.password_hash).not.toBe("secret123");
      const matches = await bcrypt.compare("secret123", row.password_hash);
      expect(matches).toBe(true);
    });

    it("trims whitespace from the name", async () => {
      const res = await post("  Engineering   ", "pw12345678");
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("Engineering");
      expect(body.slug).toBe("engineering");
    });

    it("rejects an empty name with 400", async () => {
      const res = await post("   ", "pw12345678");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });

    it("rejects an empty password with 400", async () => {
      const res = await post("My Org", "   ");
      expect(res.status).toBe(400);
    });

    it("rejects a non-JSON body with 400", async () => {
      const req = new NextRequest("http://localhost:3000/api/organizations", {
        method: "POST",
        body: "not json",
      });
      const res = await handleCreate(req, ownerCtx());
      expect(res.status).toBe(400);
    });

    it("handles slug conflict by appending a number", async () => {
      await post("Design Team", "secret123");
      const res = await post("Design Team", "secret456");
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.slug).toBe("design-team-2");
    });

    it("increments slug suffix for repeated conflicts", async () => {
      await post("My Org", "pw12345678");
      await post("My Org", "pw12345678");
      const res = await post("My Org", "pw12345678");
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.slug).toBe("my-org-3");
    });

    it("slugifies special characters", async () => {
      const res = await post("ACME Corp: Product & Design!", "pw12345678");
      expect(res.status).toBe(201);
      const body = await res.json();
      // slugify: lowercase, replace non-alphanumeric with hyphens, collapse hyphens
      const slug = body.slug;
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(slug).not.toContain("!");
      expect(slug).not.toContain(":");
      expect(slug).not.toContain("&");
    });

    it("rejects a too-short password with 400", async () => {
      const res = await post("My Org", "short");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/organizations", () => {
    async function list() {
      return handleList(
        new NextRequest("http://localhost:3000/api/organizations"),
        ownerCtx(),
      );
    }

    it("returns empty array when no orgs exist", async () => {
      const res = await list();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.organizations).toEqual([]);
    });

    it("returns orgs owned by the current user with counts", async () => {
      const res1 = await post("Design", "pw12345678");
      const org1 = await res1.json();

      const res2 = await post("Engineering", "pw12345678");
      const org2 = await res2.json();

      const listRes = await list();
      const orgs = (await listRes.json()).organizations;
      expect(orgs).toHaveLength(2);
      expect(orgs.map((o: { name: string }) => o.name).sort()).toEqual([
        "Design",
        "Engineering",
      ]);

      // Counts should be zero initially
      for (const org of orgs) {
        expect(org.memberCount).toBe(0);
        expect(org.folderCount).toBe(0);
      }
    });

    it("includes correct member and folder counts", async () => {
      const res1 = await post("Team", "pw12345678");
      const org = await res1.json();

      // Add members and folder links
      for (let i = 0; i < 3; i++) {
        db.prepare(
          "INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, ?)",
        ).run(randomUUID(), org.id, `Member ${i}`);
      }
      const groupId = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Folder')").run(
        groupId,
        TEST_USER_ID,
      );
      db.prepare(
        "INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)",
      ).run(org.id, groupId);

      const listRes = await list();
      const listed = (await listRes.json()).organizations[0];
      expect(listed.memberCount).toBe(3);
      expect(listed.folderCount).toBe(1);
    });

    it("does not leak orgs from other users", async () => {
      await post("My Org", "pw12345678");

      // Create an org for another user
      const otherOrgId = randomUUID();
      db.prepare(
        "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, 'Their Org', 'their-org', 'h')",
      ).run(otherOrgId, OTHER_USER_ID);

      const res = await list();
      const orgs = (await res.json()).organizations;
      expect(orgs).toHaveLength(1);
      expect(orgs[0].name).toBe("My Org");
    });
  });

  describe("DELETE /api/organizations/[id]", () => {
    async function del(orgId: string) {
      return handleDelete(
        new NextRequest(`http://localhost:3000/api/organizations/${orgId}`, {
          method: "DELETE",
        }),
        {
          user: { userId: TEST_USER_ID, email: "o@t.com" },
          params: { id: orgId },
        },
      );
    }

    it("deletes the organization and cascades to related data", async () => {
      const res = await post("Temp Org", "pw12345678");
      const org = await res.json();

      // Add member + folder link + member chat
      const memberId = randomUUID();
      db.prepare(
        "INSERT INTO org_members (id, organization_id, name) VALUES (?, ?, 'Bob')",
      ).run(memberId, org.id);

      const groupId = randomUUID();
      db.prepare("INSERT INTO groups (id, user_id, name) VALUES (?, ?, 'Folder')").run(
        groupId,
        TEST_USER_ID,
      );
      db.prepare(
        "INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)",
      ).run(org.id, groupId);

      const delRes = await del(org.id);
      expect(delRes.status).toBe(200);

      // Org is gone
      const orgRow = db
        .prepare("SELECT id FROM organizations WHERE id = ?")
        .get(org.id);
      expect(orgRow).toBeUndefined();

      // Members cascade-deleted
      const memberCount = db
        .prepare("SELECT COUNT(*) AS n FROM org_members WHERE organization_id = ?")
        .get(org.id) as { n: number };
      expect(memberCount.n).toBe(0);

      // Folder links cascade-deleted
      const linkCount = db
        .prepare("SELECT COUNT(*) AS n FROM org_folder_links WHERE organization_id = ?")
        .get(org.id) as { n: number };
      expect(linkCount.n).toBe(0);
    });

    it("returns 404 for a nonexistent org", async () => {
      const res = await del("does-not-exist");
      expect(res.status).toBe(404);
    });

    it("returns 403 when a non-owner tries to delete", async () => {
      const res = await post("Owner Org", "pw12345678");
      const org = await res.json();

      const nonOwnerRes = await handleDelete(
        new NextRequest(`http://localhost:3000/api/organizations/${org.id}`, {
          method: "DELETE",
        }),
        {
          user: { userId: OTHER_USER_ID, email: "x@t.com" },
          params: { id: org.id },
        },
      );
      expect(nonOwnerRes.status).toBe(403);

      // Org still exists
      const exists = db
        .prepare("SELECT id FROM organizations WHERE id = ?")
        .get(org.id);
      expect(exists).toBeTruthy();
    });
  });
});
