import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { getDb, newId } from "./db";

const SESSION_TTL_DAYS = 30;

// Overridable so tests don't pay for 12 rounds per registration
function bcryptRounds(): number {
  const fromEnv = Number(process.env.BCRYPT_ROUNDS);
  return Number.isInteger(fromEnv) && fromEnv >= 4 ? fromEnv : 12;
}

export type AuthErrorCode =
  | "invalid_email"
  | "weak_password"
  | "email_taken"
  | "invalid_credentials";

export type AuthResult =
  | { ok: true; userId: string; token: string; expiresAt: string }
  | { ok: false; code: AuthErrorCode; error: string };

export interface SessionUser {
  userId: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function createSession(userId: string): { token: string; expiresAt: string } {
  const db = getDb();
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  db.prepare(
    "INSERT INTO user_sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)",
  ).run(newId(), userId, token, expiresAt);
  return { token, expiresAt };
}

export async function registerUser(
  email: string,
  password: string,
): Promise<AuthResult> {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(normalizedEmail)) {
    return { ok: false, code: "invalid_email", error: "Invalid email address." };
  }
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      code: "weak_password",
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }

  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(normalizedEmail);
  if (existing) {
    return { ok: false, code: "email_taken", error: "Email is already registered." };
  }

  const userId = newId();
  const passwordHash = await bcrypt.hash(password, bcryptRounds());
  db.prepare(
    "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
  ).run(userId, normalizedEmail, passwordHash);

  const { token, expiresAt } = createSession(userId);
  return { ok: true, userId, token, expiresAt };
}

export async function loginUser(
  email: string,
  password: string,
): Promise<AuthResult> {
  const normalizedEmail = email?.trim().toLowerCase() ?? "";
  const db = getDb();
  const user = db
    .prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .get(normalizedEmail) as { id: string; password_hash: string } | undefined;

  const invalid: AuthResult = {
    ok: false,
    code: "invalid_credentials",
    error: "Invalid email or password.",
  };
  if (!user) return invalid;

  const matches = await bcrypt.compare(password ?? "", user.password_hash);
  if (!matches) return invalid;

  const { token, expiresAt } = createSession(user.id);
  return { ok: true, userId: user.id, token, expiresAt };
}

export function validateSession(token: string): SessionUser | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id AS user_id, u.email
       FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > datetime('now')`,
    )
    .get(token) as { user_id: string; email: string } | undefined;
  return row ? { userId: row.user_id, email: row.email } : null;
}

export function destroySession(token: string): void {
  if (!token) return;
  getDb().prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
}
