import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withOrgAuth, type OrgOwnerContext } from "@/lib/with-org-auth";

function requireOwner(ctx: { orgContext: { type: string } }): NextResponse | null {
  if (ctx.orgContext.type !== "owner") {
    return NextResponse.json(
      { error: "Only the organization owner can manage folders." },
      { status: 403 },
    );
  }
  return null;
}

// GET: list shared folders with recordings
async function handleGetFolders(
  _req: NextRequest,
  ctx: { orgContext: { orgId: string } },
): Promise<NextResponse> {
  const db = getDb();
  const orgId = ctx.orgContext.orgId;

  const folderRows = db
    .prepare(
      `SELECT g.id, g.name
       FROM org_folder_links l
       JOIN groups g ON g.id = l.group_id
       WHERE l.organization_id = ?
       ORDER BY g.name COLLATE NOCASE ASC`,
    )
    .all(orgId) as { id: string; name: string }[];

  const folders = folderRows.map((f) => {
    const recordings = db
      .prepare(
        `SELECT id, filename, source, duration_seconds, speaker_count,
                action_items_json, group_name, group_id, created_at
         FROM recordings
         WHERE group_id = ?
         ORDER BY created_at DESC`,
      )
      .all(f.id) as {
      id: string;
      filename: string;
      source: string;
      duration_seconds: number | null;
      speaker_count: number;
      action_items_json: string | null;
      group_name: string | null;
      group_id: string | null;
      created_at: string;
    }[];

    return {
      id: f.id,
      name: f.name,
      recordings: recordings.map((r) => {
        let actionItemCount = 0;
        try {
          const items = JSON.parse(r.action_items_json ?? "[]");
          if (Array.isArray(items)) actionItemCount = items.length;
        } catch { /* ignore malformed JSON */ }
        return {
          id: r.id,
          filename: r.filename,
          source: r.source,
          durationSeconds: r.duration_seconds,
          speakerCount: r.speaker_count,
          actionItemCount,
          groupName: r.group_name,
          groupId: r.group_id,
          createdAt: r.created_at,
        };
      }),
    };
  });

  return NextResponse.json({ folders });
}

// POST: add folder to org (owner only)
async function handleAddFolder(
  req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string; userId?: string } },
): Promise<NextResponse> {
  const authError = requireOwner(ctx);
  if (authError) return authError;

  let body: { groupId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.groupId !== "string" || !body.groupId.trim()) {
    return NextResponse.json({ error: "groupId is required." }, { status: 400 });
  }

  const groupId = body.groupId.trim();
  const db = getDb();
  const userId = (ctx.orgContext as OrgOwnerContext).userId;
  const orgId = ctx.orgContext.orgId;

  // Verify group exists and belongs to owner
  const group = db
    .prepare("SELECT id, name FROM groups WHERE id = ? AND user_id = ?")
    .get(groupId, userId) as { id: string; name: string } | undefined;

  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }

  // Check not already shared
  const existing = db
    .prepare("SELECT organization_id FROM org_folder_links WHERE group_id = ?")
    .get(groupId) as { organization_id: string } | undefined;

  if (existing) {
    return NextResponse.json(
      { error: "This folder is already shared with an organization." },
      { status: 409 },
    );
  }

  db.prepare(
    "INSERT INTO org_folder_links (organization_id, group_id) VALUES (?, ?)",
  ).run(orgId, groupId);

  return NextResponse.json({ folderId: group.id, folderName: group.name }, { status: 201 });
}

// DELETE: remove folder from org (owner only)
async function handleRemoveFolder(
  req: NextRequest,
  ctx: { orgContext: { orgId: string; type: string } },
): Promise<NextResponse> {
  const authError = requireOwner(ctx);
  if (authError) return authError;

  const groupId = req.nextUrl.searchParams.get("groupId");
  if (!groupId) {
    return NextResponse.json({ error: "groupId query param is required." }, { status: 400 });
  }

  const db = getDb();
  db.prepare(
    "DELETE FROM org_folder_links WHERE organization_id = ? AND group_id = ?",
  ).run(ctx.orgContext.orgId, groupId);

  return NextResponse.json({ removed: true });
}

export const GET = withOrgAuth(handleGetFolders);
export const POST = withOrgAuth(handleAddFolder);
export const DELETE = withOrgAuth(handleRemoveFolder);

export { handleGetFolders, handleAddFolder, handleRemoveFolder };
