import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { listJobs } from "@/lib/queue";
import { sseResponse } from "@/lib/sse";

export const GET = withAuth(async (req: NextRequest, { user }) => {
  if (req.nextUrl.searchParams.get("stream") === "true") {
    return sseResponse(() => ({ jobs: listJobs(user.userId) }));
  }
  return NextResponse.json({ jobs: listJobs(user.userId) });
});
