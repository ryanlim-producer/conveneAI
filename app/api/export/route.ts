import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getDb } from "@/lib/db";

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** Full data export: every recording with transcript, speakers and action items. */
export const GET = withAuth(async (_req: NextRequest, { user }) => {
  const rows = getDb()
    .prepare(
      `SELECT id, filename, source, group_name, duration_seconds, speaker_count,
              transcript_text, segments_json, speaker_map_json, action_items_json,
              model_used, created_at
       FROM recordings WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .all(user.userId) as Record<string, unknown>[];

  const recordings = rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    source: r.source,
    group: r.group_name,
    durationSeconds: r.duration_seconds,
    speakerCount: r.speaker_count,
    modelUsed: r.model_used,
    createdAt: r.created_at,
    fullTranscript: r.transcript_text ?? "",
    speakers: safeParse<Record<string, string>>(r.speaker_map_json as string | null, {}),
    segments: safeParse<unknown[]>(r.segments_json as string | null, []),
    actionItems: safeParse<unknown[]>(r.action_items_json as string | null, []),
  }));

  const filename = `conveneai-export-${new Date().toISOString().slice(0, 10)}.json`;
  return new NextResponse(
    JSON.stringify(
      { exportedAt: new Date().toISOString(), account: user.email, total: recordings.length, recordings },
      null,
      2,
    ),
    {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    },
  );
});
