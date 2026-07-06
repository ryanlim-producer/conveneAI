import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getJob } from "@/lib/queue";

export const GET = withAuth<{ id: string }>(async (_req: NextRequest, { user, params }) => {
  const job = params?.id ? getJob(params.id, user.userId) : null;
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }
  return NextResponse.json({ job });
});
