import { NextRequest, NextResponse } from "next/server";
import { registerUser } from "@/lib/auth";
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

  const result = await registerUser(body.email, body.password);
  if (!result.ok) {
    const status = result.code === "email_taken" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  const res = NextResponse.json({ userId: result.userId }, { status: 201 });
  res.cookies.set(AUTH_COOKIE, result.token, {
    ...AUTH_COOKIE_OPTIONS,
    expires: new Date(result.expiresAt),
  });
  return res;
}
