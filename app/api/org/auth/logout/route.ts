import { NextRequest, NextResponse } from "next/server";
import { destroyOrgSession, ORG_AUTH_COOKIE } from "@/lib/org-auth";
import { ORG_AUTH_COOKIE_OPTIONS } from "@/app/api/org/auth/route";

async function handleOrgLogout(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(ORG_AUTH_COOKIE)?.value;
  if (token) {
    destroyOrgSession(token);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ORG_AUTH_COOKIE, "", {
    ...ORG_AUTH_COOKIE_OPTIONS,
    expires: new Date(0),
  });
  return res;
}

export const POST = handleOrgLogout;
export { handleOrgLogout };
