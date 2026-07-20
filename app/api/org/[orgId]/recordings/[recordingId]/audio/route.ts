import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPresignedUrl } from "@/lib/s3";
import { withOrgAuth } from "@/lib/with-org-auth";

const EXPIRES_IN_SECONDS = 3600;

export const GET = withOrgAuth<{ recordingId: string }>(
  async (_req: NextRequest, { orgContext, params }) => {
    const orgId = orgContext.orgId;
    const recordingId = params?.recordingId;
    if (!recordingId) {
      return NextResponse.json({ error: "Missing recordingId." }, { status: 400 });
    }

    const db = getDb();

    // Verify recording belongs to a shared folder
    const folderIds = (
      db.prepare("SELECT group_id FROM org_folder_links WHERE organization_id = ?").all(orgId) as { group_id: string }[]
    ).map((r) => r.group_id);

    if (folderIds.length === 0) {
      return NextResponse.json({ error: "Recording not found." }, { status: 404 });
    }

    const placeholders = folderIds.map(() => "?").join(",");
    const row = db
      .prepare(
        `SELECT s3_key FROM recordings WHERE id = ? AND group_id IN (${placeholders})`,
      )
      .get(recordingId, ...folderIds) as { s3_key: string | null } | undefined;

    if (!row) {
      return NextResponse.json({ error: "Recording not found." }, { status: 404 });
    }
    if (!row.s3_key) {
      return NextResponse.json({ error: "No audio stored for this recording." }, { status: 404 });
    }

    const url = await getPresignedUrl(row.s3_key, EXPIRES_IN_SECONDS);
    return NextResponse.json({ url, expiresIn: EXPIRES_IN_SECONDS });
  },
);
