import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { newId } from "@/lib/db";
import { isAudioFile, contentTypeFor } from "@/lib/audio-files";
import { audioKey, uploadAudio } from "@/lib/s3";
import { enqueueJob, type JobSource } from "@/lib/queue";
import { nudgeWorker } from "@/lib/worker";

const DEFAULT_MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB

function maxUploadBytes(): number {
  const fromEnv = Number(process.env.MAX_UPLOAD_BYTES);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_UPLOAD_BYTES;
}

const UPLOAD_SOURCES: JobSource[] = ["desktop", "telegram", "web_upload"];

export const POST = withAuth(async (req: NextRequest, { user }) => {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { error: "No file provided. Upload an audio file with field name 'file'." },
      { status: 400 },
    );
  }

  if (!isAudioFile(file.type, file.name)) {
    return NextResponse.json(
      { error: "Invalid file type. Please upload an audio file (MP3, WAV, WebM, OGG, M4A)." },
      { status: 400 },
    );
  }

  if (file.size > maxUploadBytes()) {
    return NextResponse.json(
      { error: `File too large. Maximum size is ${Math.floor(maxUploadBytes() / (1024 * 1024))}MB.` },
      { status: 413 },
    );
  }

  const language = (formData.get("language") as string) || "en";
  const requestedSource = formData.get("source") as string | null;
  const source: JobSource = UPLOAD_SOURCES.includes(requestedSource as JobSource)
    ? (requestedSource as JobSource)
    : "web_upload";

  const jobId = newId();
  const s3Key = audioKey(user.userId, jobId, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await uploadAudio(s3Key, buffer, contentTypeFor(file.name, file.type));
  } catch (error) {
    console.error("S3 upload failed:", error);
    return NextResponse.json(
      { error: "Failed to store the audio file. Please try again." },
      { status: 500 },
    );
  }

  const job = enqueueJob({
    id: jobId,
    userId: user.userId,
    filename: file.name,
    s3Key,
    source,
    language,
  });

  nudgeWorker();

  return NextResponse.json({ jobId: job.id, status: job.status }, { status: 202 });
});
