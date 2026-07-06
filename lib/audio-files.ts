import path from "path";

export const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
];

export const ALLOWED_EXTENSIONS = [".mp3", ".wav", ".webm", ".ogg", ".m4a", ".mp4"];

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".m4a": "audio/x-m4a",
  ".mp4": "audio/mp4",
};

export function isAudioFile(mimeType: string, filename: string): boolean {
  if (ALLOWED_AUDIO_TYPES.includes(mimeType)) return true;
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

export function contentTypeFor(filename: string, mimeType?: string): string {
  if (mimeType && ALLOWED_AUDIO_TYPES.includes(mimeType)) return mimeType;
  const ext = path.extname(filename).toLowerCase();
  return EXTENSION_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export function audioExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext) ? ext : ".mp3";
}
