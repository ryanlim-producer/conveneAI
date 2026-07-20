import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import type { SessionUser } from "@/lib/auth";
import { getDb, newId } from "@/lib/db";
import bcrypt from "bcryptjs";

const MIN_PASSWORD_LENGTH = 8;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

async function handleCreate(
  req: NextRequest,
  ctx: { user: SessionUser },
): Promise<NextResponse> {
  let body: { name?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "Organization name cannot be empty." }, { status: 400 });
  }

  if (typeof body.password !== "string" || !body.password.trim()) {
    return NextResponse.json(
      { error: "Password cannot be empty." },
      { status: 400 },
    );
  }

  const password = body.password.trim();
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400 },
    );
  }

  const name = body.name.trim();
  let slug = slugify(name);
  if (!slug) slug = "org";

  const db = getDb();

  // Handle slug conflicts by appending -2, -3, etc.
  let suffix = 1;
  let candidate = slug;
  while (
    db.prepare("SELECT id FROM organizations WHERE slug = ?").get(candidate)
  ) {
    suffix++;
    candidate = `${slug}-${suffix}`;
  }

  const id = newId();
  const passwordHash = await bcrypt.hash(password, 12);

  db.prepare(
    "INSERT INTO organizations (id, user_id, name, slug, password_hash) VALUES (?, ?, ?, ?, ?)",
  ).run(id, ctx.user.userId, name, candidate, passwordHash);

  const createdAt = (
    db
      .prepare("SELECT created_at FROM organizations WHERE id = ?")
      .get(id) as { created_at: string }
  ).created_at;

  return NextResponse.json(
    { id, name, slug: candidate, createdAt },
    { status: 201 },
  );
}

async function handleList(
  _req: NextRequest,
  ctx: { user: SessionUser },
): Promise<NextResponse> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT o.id, o.name, o.slug, o.created_at,
              (SELECT COUNT(*) FROM org_members m WHERE m.organization_id = o.id) AS member_count,
              (SELECT COUNT(*) FROM org_folder_links l WHERE l.organization_id = o.id) AS folder_count
       FROM organizations o
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC`,
    )
    .all(ctx.user.userId) as {
    id: string;
    name: string;
    slug: string;
    created_at: string;
    member_count: number;
    folder_count: number;
  }[];

  const organizations = rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    memberCount: row.member_count,
    folderCount: row.folder_count,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ organizations });
}

export const POST = withAuth(handleCreate);
export const GET = withAuth(handleList);

export { handleCreate, handleList };
