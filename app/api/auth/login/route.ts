import { NextRequest, NextResponse } from "next/server";
import { loginUser } from "@/lib/auth";
import { AUTH_COOKIE, AUTH_COOKIE_OPTIONS } from "@/lib/with-auth";

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.email || !body.password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 },
    );
  }

  const result = await loginUser(body.email, body.password);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 401 });
  }

  const res = NextResponse.json({ userId: result.userId });
  res.cookies.set(AUTH_COOKIE, result.token, {
    ...AUTH_COOKIE_OPTIONS,
    expires: new Date(result.expiresAt),
  });
  return res;
}
