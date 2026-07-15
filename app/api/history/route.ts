import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import type { SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

interface RecordingRow {
  id: string;
  filename: string;
  source: "desktop" | "telegram" | "web_upload";
  duration_seconds: number | null;
  speaker_count: number;
  action_items_json: string | null;
  group_name: string | null;
  group_id: string | null;
  created_at: string;
  job_status: string | null;
}

async function handleGetHistory(
  _req: NextRequest,
  ctx: { user: SessionUser },
): Promise<NextResponse> {
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT r.id, r.filename, r.source, r.duration_seconds, r.speaker_count,
              r.action_items_json, r.group_name, r.group_id, r.created_at, j.status AS job_status
       FROM recordings r
       LEFT JOIN jobs j ON j.id = r.job_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`,
    )
    .all(ctx.user.userId) as RecordingRow[];

  const recordings = rows.map((row) => {
    let actionItemCount = 0;
    try {
      const items = JSON.parse(row.action_items_json ?? "[]");
      if (Array.isArray(items)) actionItemCount = items.length;
    } catch {
      // Malformed JSON in DB — treat as no action items
    }
    return {
      id: row.id,
      filename: row.filename,
      source: row.source,
      durationSeconds: row.duration_seconds,
      speakerCount: row.speaker_count,
      actionItemCount,
      group: row.group_name,
      groupId: row.group_id,
      groupName: row.group_name,
      jobStatus: row.job_status,
      createdAt: row.created_at,
    };
  });

  return NextResponse.json({ recordings, total: recordings.length });
}

export const GET = withAuth(handleGetHistory);

// Exported for testing
export { handleGetHistory };
