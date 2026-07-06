import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import type { SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { deleteAudio } from "@/lib/s3";

interface RecordingDetailRow {
  id: string;
  filename: string;
  source: "desktop" | "telegram" | "web_upload";
  duration_seconds: number | null;
  speaker_count: number;
  s3_key: string | null;
  transcript_text: string | null;
  segments_json: string | null;
  speaker_map_json: string | null;
  action_items_json: string | null;
  model_used: string | null;
  job_id: string | null;
  created_at: string;
}

function safeParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

function getRecording(userId: string, id: string): RecordingDetailRow | undefined {
  const db = getDb();
  return db
    .prepare("SELECT * FROM recordings WHERE id = ? AND user_id = ?")
    .get(id, userId) as RecordingDetailRow | undefined;
}

async function handleGetDetail(
  _req: NextRequest,
  ctx: { user: SessionUser; params?: { id: string } },
): Promise<NextResponse> {
  const id = ctx.params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing recording id." }, { status: 400 });
  }

  const row = getRecording(ctx.user.userId, id);
  if (!row) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  const speakerMap = safeParse<Record<string, string>>(row.speaker_map_json, {});
  const speakers = Object.entries(speakerMap).map(([id, name]) => ({ id, name }));

  const jobStatus = row.job_id
    ? ((getDb().prepare("SELECT status FROM jobs WHERE id = ?").get(row.job_id) as
        | { status: string }
        | undefined)?.status ?? null)
    : null;

  return NextResponse.json({
    id: row.id,
    filename: row.filename,
    source: row.source,
    durationSeconds: row.duration_seconds,
    speakerCount: row.speaker_count,
    modelUsed: row.model_used,
    fullTranscript: row.transcript_text ?? "",
    segments: safeParse<unknown[]>(row.segments_json, []),
    speakers,
    actionItems: safeParse<unknown[]>(row.action_items_json, []),
    jobStatus,
    hasAudio: Boolean(row.s3_key),
    createdAt: row.created_at,
  });
}

async function handleDelete(
  _req: NextRequest,
  ctx: { user: SessionUser; params?: { id: string } },
): Promise<NextResponse> {
  const id = ctx.params?.id;
  if (!id) {
    return NextResponse.json({ error: "Missing recording id." }, { status: 400 });
  }

  const row = getRecording(ctx.user.userId, id);
  if (!row) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }

  // S3 audio removal is best effort — DB record removal must not fail on it
  if (row.s3_key) {
    try {
      await deleteAudio(row.s3_key);
    } catch (err) {
      console.error("Failed to delete S3 audio:", err);
    }
  }

  const db = getDb();
  // chat_messages cascade via FK; delete explicitly too in case foreign_keys is off
  db.prepare("DELETE FROM chat_messages WHERE recording_id = ?").run(id);
  db.prepare("DELETE FROM recordings WHERE id = ? AND user_id = ?").run(id, ctx.user.userId);

  return NextResponse.json({ deleted: true, id });
}

export const GET = withAuth<{ id: string }>(handleGetDetail);
export const DELETE = withAuth<{ id: string }>(handleDelete);

// Exported for testing
export { handleGetDetail, handleDelete };
