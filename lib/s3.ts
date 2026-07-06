import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { audioExtension } from "./audio-files";

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({ region: process.env.AWS_REGION ?? "ap-southeast-1" });
  }
  return client;
}

function bucket(): string {
  const name = process.env.AWS_S3_BUCKET;
  if (!name) throw new Error("AWS_S3_BUCKET is not configured.");
  return name;
}

export function audioKey(userId: string, jobId: string, filename: string): string {
  return `uploads/${userId}/${jobId}${audioExtension(filename)}`;
}

export async function uploadAudio(
  key: string,
  body: Buffer,
  contentType = "audio/mpeg",
): Promise<void> {
  await s3().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getAudioBuffer(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!res.Body) throw new Error(`S3 object ${key} has no body.`);
  return Buffer.from(await res.Body.transformToByteArray());
}

export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn });
}

export async function deleteAudio(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
