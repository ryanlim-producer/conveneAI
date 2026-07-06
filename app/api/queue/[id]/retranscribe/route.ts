import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getJob, enqueueJob } from "@/lib/queue";
import { nudgeWorker } from "@/lib/worker";

const IN_FLIGHT = ["queued", "transcribing", "processing_action_items"];

export const POST = withAuth<{ id: string }>(async (_req: NextRequest, { user, params }) => {
  const job = params?.id ? getJob(params.id, user.userId) : null;
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (IN_FLIGHT.includes(job.status)) {
    return NextResponse.json(
      { error: "This job is still processing. Wait for it to finish first." },
      { status: 409 },
    );
  }

  if (!job.s3Key) {
    return NextResponse.json(
      { error: "The original audio is no longer available." },
      { status: 409 },
    );
  }

  // New job + (eventually) new recording; the original stays untouched.
  const fresh = enqueueJob({
    userId: user.userId,
    filename: job.filename,
    s3Key: job.s3Key,
    source: job.source,
    language: job.language,
  });
  nudgeWorker();

  return NextResponse.json({ jobId: fresh.id, status: fresh.status }, { status: 202 });
});
