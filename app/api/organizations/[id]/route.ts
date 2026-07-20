import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import type { SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

async function handleDelete(
  _req: NextRequest,
  ctx: { user: SessionUser; params?: { id: string } },
): Promise<NextResponse> {
  const id = ctx.params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing organization id." }, { status: 400 });
  }

  const db = getDb();

  // Verify ownership
  const org = db
    .prepare("SELECT id, user_id FROM organizations WHERE id = ?")
    .get(id) as { id: string; user_id: string } | undefined;

  if (!org) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  if (org.user_id !== ctx.user.userId) {
    return NextResponse.json(
      { error: "You do not have permission to delete this organization." },
      { status: 403 },
    );
  }

  // Cascade: delete org → members → member sessions → folder links
  // (sqlite foreign keys with ON DELETE CASCADE handle this)
  db.prepare("DELETE FROM organizations WHERE id = ?").run(id);

  return NextResponse.json({ deleted: true });
}

export const DELETE = withAuth<{ id: string }>(handleDelete);

export { handleDelete };
