import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";

process.env.BCRYPT_ROUNDS = "4"; // keep hashing fast in tests

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}));

vi.mock("@/lib/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db")>();
  return { ...actual, getDb: getDbMock };
});

import { initSchema } from "@/lib/db";
import { registerUser, loginUser, validateSession, destroySession } from "@/lib/auth";

describe("auth", () => {
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

  it("a registered user can log in and their session token identifies them", async () => {
    const registered = await registerUser("alice@example.com", "hunter2secret");
    expect(registered.ok).toBe(true);

    const login = await loginUser("alice@example.com", "hunter2secret");
    expect(login.ok).toBe(true);
    if (!login.ok) return;

    const user = validateSession(login.token);
    expect(user?.email).toBe("alice@example.com");
    expect(user?.userId).toBe(login.userId);
  });

  it("registration itself yields a usable session token", async () => {
    const registered = await registerUser("bob@example.com", "hunter2secret");
    expect(registered.ok).toBe(true);
    if (!registered.ok) return;
    expect(validateSession(registered.token)?.userId).toBe(registered.userId);
  });

  it("rejects registering an email that is already taken", async () => {
    await registerUser("alice@example.com", "hunter2secret");
    const second = await registerUser("alice@example.com", "otherpassword");
    expect(second).toMatchObject({ ok: false, code: "email_taken" });
  });

  it("treats email as case-insensitive across register and login", async () => {
    await registerUser("Alice@Example.COM", "hunter2secret");
    const login = await loginUser("alice@example.com", "hunter2secret");
    expect(login.ok).toBe(true);

    const dup = await registerUser("ALICE@EXAMPLE.COM", "hunter2secret");
    expect(dup).toMatchObject({ ok: false, code: "email_taken" });
  });

  it("rejects registration with a malformed email", async () => {
    const result = await registerUser("not-an-email", "hunter2secret");
    expect(result).toMatchObject({ ok: false, code: "invalid_email" });
  });

  it("rejects registration with a password shorter than 8 characters", async () => {
    const result = await registerUser("alice@example.com", "short");
    expect(result).toMatchObject({ ok: false, code: "weak_password" });
  });

  it("rejects login with a wrong password", async () => {
    await registerUser("alice@example.com", "hunter2secret");
    const login = await loginUser("alice@example.com", "wrongpassword");
    expect(login).toMatchObject({ ok: false, code: "invalid_credentials" });
  });

  it("rejects login for an unknown email", async () => {
    const login = await loginUser("ghost@example.com", "hunter2secret");
    expect(login).toMatchObject({ ok: false, code: "invalid_credentials" });
  });

  it("a destroyed session token is no longer valid", async () => {
    const reg = await registerUser("alice@example.com", "hunter2secret");
    if (!reg.ok) throw new Error("registration failed");
    destroySession(reg.token);
    expect(validateSession(reg.token)).toBeNull();
  });

  it("an expired session token is no longer valid", async () => {
    const reg = await registerUser("alice@example.com", "hunter2secret");
    if (!reg.ok) throw new Error("registration failed");
    db.prepare(
      "UPDATE user_sessions SET expires_at = datetime('now', '-1 day') WHERE token = ?",
    ).run(reg.token);
    expect(validateSession(reg.token)).toBeNull();
  });

  it("a garbage token is not valid", () => {
    expect(validateSession("no-such-token")).toBeNull();
  });
});
