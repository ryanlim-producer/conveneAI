import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { NextRequest, NextResponse } from "next/server";

process.env.BCRYPT_ROUNDS = "4";

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { validateSession } from "@/lib/auth";
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { POST as loginRoute } from "@/app/api/auth/login/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { withAuth, AUTH_COOKIE } from "@/lib/with-auth";

function jsonRequest(url: string, body: unknown, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("auth API routes", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    initSchema(db);
    getDbMock.mockReturnValue(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("POST /api/auth/register", () => {
    it("creates an account, returns 201 and sets an httpOnly session cookie", async () => {
      const res = await registerRoute(
        jsonRequest("/api/auth/register", { email: "alice@example.com", password: "hunter2secret" }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.userId).toBeTruthy();

      const cookie = res.cookies.get(AUTH_COOKIE);
      expect(cookie?.value).toBeTruthy();
      expect(cookie?.httpOnly).toBe(true);
      expect(validateSession(cookie!.value)?.userId).toBe(body.userId);
    });

    it("returns 409 for an email that is already registered", async () => {
      await registerRoute(
        jsonRequest("/api/auth/register", { email: "alice@example.com", password: "hunter2secret" }),
      );
      const res = await registerRoute(
        jsonRequest("/api/auth/register", { email: "alice@example.com", password: "hunter2secret" }),
      );
      expect(res.status).toBe(409);
    });

    it("returns 400 for an invalid email", async () => {
      const res = await registerRoute(
        jsonRequest("/api/auth/register", { email: "nope", password: "hunter2secret" }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for a too-short password", async () => {
      const res = await registerRoute(
        jsonRequest("/api/auth/register", { email: "alice@example.com", password: "short" }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for a non-JSON body", async () => {
      const req = new NextRequest("http://localhost/api/auth/register", {
        method: "POST",
        body: "not json",
      });
      const res = await registerRoute(req);
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await registerRoute(
        jsonRequest("/api/auth/register", { email: "alice@example.com", password: "hunter2secret" }),
      );
    });

    it("returns 200 and a session cookie for valid credentials", async () => {
      const res = await loginRoute(
        jsonRequest("/api/auth/login", { email: "alice@example.com", password: "hunter2secret" }),
      );
      expect(res.status).toBe(200);
      const cookie = res.cookies.get(AUTH_COOKIE);
      expect(validateSession(cookie!.value)?.email).toBe("alice@example.com");
    });

    it("returns 401 for a wrong password", async () => {
      const res = await loginRoute(
        jsonRequest("/api/auth/login", { email: "alice@example.com", password: "wrongwrong" }),
      );
      expect(res.status).toBe(401);
      expect(res.cookies.get(AUTH_COOKIE)).toBeUndefined();
    });

    it("returns 400 when fields are missing", async () => {
      const res = await loginRoute(jsonRequest("/api/auth/login", { email: "alice@example.com" }));
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("invalidates the session and clears the cookie", async () => {
      const reg = await registerRoute(
        jsonRequest("/api/auth/register", { email: "alice@example.com", password: "hunter2secret" }),
      );
      const token = reg.cookies.get(AUTH_COOKIE)!.value;

      const res = await logoutRoute(
        jsonRequest("/api/auth/logout", {}, `${AUTH_COOKIE}=${token}`),
      );
      expect(res.status).toBe(200);
      expect(validateSession(token)).toBeNull();
      expect(res.cookies.get(AUTH_COOKIE)?.value).toBe("");
    });
  });

  describe("withAuth", () => {
    const echoUser = withAuth(async (_req, ctx) =>
      NextResponse.json({ userId: ctx.user.userId, email: ctx.user.email }),
    );

    it("rejects requests without a session cookie with 401", async () => {
      const res = await echoUser(
        new NextRequest("http://localhost/api/protected"),
      );
      expect(res.status).toBe(401);
    });

    it("rejects requests with an invalid token with 401", async () => {
      const res = await echoUser(
        new NextRequest("http://localhost/api/protected", {
          headers: { cookie: `${AUTH_COOKIE}=bogus` },
        }),
      );
      expect(res.status).toBe(401);
    });

    it("passes the authenticated user to the handler", async () => {
      const reg = await registerRoute(
        jsonRequest("/api/auth/register", { email: "alice@example.com", password: "hunter2secret" }),
      );
      const token = reg.cookies.get(AUTH_COOKIE)!.value;

      const res = await echoUser(
        new NextRequest("http://localhost/api/protected", {
          headers: { cookie: `${AUTH_COOKIE}=${token}` },
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ email: "alice@example.com" });
    });
  });
});
