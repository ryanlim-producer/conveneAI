import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getDb } from "@/lib/db";
import { getJob } from "@/lib/queue";

export const GET = withAuth<{ id: string }>(async (_req: NextRequest, { user, params }) => {
  const job = params?.id ? getJob(params.id, user.userId) : null;
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  return NextResponse.json({ job });
});

/** Rename a job — and its recording once (or if already) transcribed. */
export const PATCH = withAuth<{ id: string }>(async (req: NextRequest, { user, params }) => {
  const job = params?.id ? getJob(params.id, user.userId) : null;
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  let body: { filename?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (typeof body.filename !== "string" || !body.filename.trim()) {
    return NextResponse.json({ error: "Filename cannot be empty." }, { status: 400 });
  }
  const filename = body.filename.trim();

  const db = getDb();
  db.prepare("UPDATE jobs SET filename = ? WHERE id = ?").run(filename, job.id);
  if (job.recordingId) {
    db.prepare("UPDATE recordings SET filename = ? WHERE id = ?").run(filename, job.recordingId);
  }

  return NextResponse.json({ updated: true, filename });
});
