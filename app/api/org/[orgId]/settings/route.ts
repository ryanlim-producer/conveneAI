import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withOrgAuth } from "@/lib/with-org-auth";
import bcrypt from "bcryptjs";

function requireOwner(ctx: { orgContext: { type: string } }): NextResponse | null {
  if (ctx.orgContext.type !== "owner") {
    return NextResponse.json(
      { error: "Only the organization owner can change settings." },
      { status: 403 },
    );
  }
  return null;
}

// PATCH: update org settings (password)
async function handleUpdateSettings(
  req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string } },
): Promise<NextResponse> {
  const authError = requireOwner(ctx);
  if (authError) return authError;

  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.password !== "string" || !body.password.trim() || body.password.trim().length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const hash = bcrypt.hashSync(body.password.trim(), 12);
  getDb()
    .prepare("UPDATE organizations SET password_hash = ? WHERE id = ?")
    .run(hash, ctx.orgContext.orgId);

  return NextResponse.json({ ok: true });
}

export const PATCH = withOrgAuth(handleUpdateSettings);
export { handleUpdateSettings };
