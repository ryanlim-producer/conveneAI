import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { withOrgAuth } from "@/lib/with-org-auth";

async function handleGetRecording(
  _req: NextRequest,
  ctx: { orgContext: { orgId: string }; params?: { recordingId: string } },
): Promise<NextResponse> {
  const orgId = ctx.orgContext.orgId;
  const recordingId = ctx.params?.recordingId;
  if (!recordingId) return NextResponse.json({ error: "Missing recordingId." }, { status: 400 });

  const db = getDb();

  // Verify recording belongs to a shared folder in this org
  const folderIds = (
    db.prepare("SELECT group_id FROM org_folder_links WHERE organization_id = ?").all(orgId) as { group_id: string }[]
  ).map((r) => r.group_id);

  if (folderIds.length === 0) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const placeholders = folderIds.map(() => "?").join(",");
  const rec = db
    .prepare(
      `SELECT r.id, r.filename, r.source, r.duration_seconds, r.speaker_count,
              r.transcript_text, r.segments_json, r.speaker_map_json, r.action_items_json,
              r.group_id, r.group_name, r.s3_key, r.created_at
       FROM recordings r WHERE r.id = ? AND r.group_id IN (${placeholders})`,
    )
    .get(recordingId, ...folderIds) as {
    id: string; filename: string; source: string; duration_seconds: number | null;
    speaker_count: number; transcript_text: string | null; segments_json: string | null;
    speaker_map_json: string | null; action_items_json: string | null;
    group_id: string | null; group_name: string | null; s3_key: string | null; created_at: string;
  } | undefined;

  if (!rec) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  function safeParse<T>(json: string | null, fallback: T): T {
    if (!json) return fallback;
    try { return JSON.parse(json) as T; } catch { return fallback; }
  }

  return NextResponse.json({
    id: rec.id,
    filename: rec.filename,
    source: rec.source,
    durationSeconds: rec.duration_seconds,
    speakerCount: rec.speaker_count,
    fullTranscript: rec.transcript_text ?? "",
    segments: safeParse(rec.segments_json, []),
    speakers: (() => {
      const map = safeParse<Record<string, string>>(rec.speaker_map_json, {});
      return Object.entries(map).map(([id, name]) => ({ id, name }));
    })(),
    actionItems: safeParse(rec.action_items_json, []),
    hasAudio: !!rec.s3_key,
    groupId: rec.group_id,
    groupName: rec.group_name,
    createdAt: rec.created_at,
  });
}

export const GET = withOrgAuth(handleGetRecording);
export { handleGetRecording };
