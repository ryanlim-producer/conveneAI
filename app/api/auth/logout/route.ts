import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { AUTH_COOKIE, AUTH_COOKIE_OPTIONS } from "@/lib/with-auth";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (token) {
    destroySession(token);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", { ...AUTH_COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
