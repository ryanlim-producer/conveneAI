import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession, SessionUser } from "./auth";
import { AUTH_COOKIE } from "./with-auth";

// Server-side page guard. The proxy middleware only checks cookie
// *presence* (edge can't hit SQLite), so a stale or forged cookie still
// reaches the page and surfaces as a "Not authenticated" API error.
// This validates against the DB and redirects to login before render.
export async function requireUser(next?: string): Promise<SessionUser> {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  const user = token ? validateSession(token) : null;
  if (!user) {
    redirect(next && next !== "/" ? `/login?next=${encodeURIComponent(next)}` : "/login");
  }
  return user;
}
