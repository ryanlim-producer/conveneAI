import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { getDb } from "@/lib/db";
import { getPresignedUrl } from "@/lib/s3";

const EXPIRES_IN_SECONDS = 3600;

export const GET = withAuth<{ id: string }>(async (_req: NextRequest, { user, params }) => {
  const row = params?.id
    ? (getDb()
        .prepare("SELECT s3_key FROM recordings WHERE id = ? AND user_id = ?")
        .get(params.id, user.userId) as { s3_key: string | null } | undefined)
    : undefined;

  if (!row) {
    return NextResponse.json({ error: "Recording not found." }, { status: 404 });
  }
  if (!row.s3_key) {
    return NextResponse.json(
      { error: "No audio stored for this recording." },
      { status: 404 },
    );
  }

  const url = await getPresignedUrl(row.s3_key, EXPIRES_IN_SECONDS);
  return NextResponse.json({ url, expiresIn: EXPIRES_IN_SECONDS });
});
