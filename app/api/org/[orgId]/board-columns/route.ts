import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb } from "@/lib/db";
import { withOrgAuth } from "@/lib/with-org-auth";

export const BUILTIN_ACTION_ITEMS_COLUMN = { id: "action-items", name: "Action Items", builtin: true as const };

function requireOwner(ctx: { orgContext: { type: string } }): NextResponse | null {
  if (ctx.orgContext.type !== "owner") {
    return NextResponse.json(
      { error: "Only the organization owner can change the board's columns." },
      { status: 403 },
    );
  }
  return null;
}

// GET: list kanban columns — the builtin "Action Items" column first, then any
// owner-added custom columns in position order.
async function handleGetColumns(
  _req: NextRequest,
  ctx: { orgContext: { orgId: string } },
): Promise<NextResponse> {
  const rows = getDb()
    .prepare(
      `SELECT id, name FROM org_board_columns
       WHERE organization_id = ?
       ORDER BY position ASC`,
    )
    .all(ctx.orgContext.orgId) as { id: string; name: string }[];

  const columns = [
    BUILTIN_ACTION_ITEMS_COLUMN,
    ...rows.map((r) => ({ id: r.id, name: r.name, builtin: false as const })),
  ];

  return NextResponse.json({ columns });
}

// POST: add a new custom column (owner only)
async function handleAddColumn(
  req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string } },
): Promise<NextResponse> {
  const authError = requireOwner(ctx);
  if (authError) return authError;

  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Column name is required." }, { status: 400 });
  }

  const db = getDb();
  const orgId = ctx.orgContext.orgId;

  const { count } = db
    .prepare("SELECT COUNT(*) as count FROM org_board_columns WHERE organization_id = ?")
    .get(orgId) as { count: number };

  const id = randomUUID();
  db.prepare(
    "INSERT INTO org_board_columns (id, organization_id, name, position) VALUES (?, ?, ?, ?)",
  ).run(id, orgId, name, count + 1);

  return NextResponse.json({ id, name, builtin: false }, { status: 201 });
}

export const GET = withOrgAuth(handleGetColumns);
export const POST = withOrgAuth(handleAddColumn);

export { handleGetColumns, handleAddColumn };
