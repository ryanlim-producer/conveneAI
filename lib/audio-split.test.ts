import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getAudioDurationSeconds, splitAudioIntoChunks } from "@/lib/audio-split";

const execFileAsync = promisify(execFile);

// These run the real ffmpeg/ffprobe binaries — they're a hard runtime
// dependency of the pipeline, so testing against them is the honest seam.

async function makeAudio(format: "mp3" | "m4a" | "oga", seconds: number): Promise<Buffer> {
  const codec = { mp3: "libmp3lame", m4a: "aac", oga: "libopus" }[format];
  const file = path.join(os.tmpdir(), `asisvoz-split-test-${Date.now()}.${format}`);
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", `sine=frequency=440:duration=${seconds}`,
    "-c:a", codec,
    file,
  ]);
  const buffer = await fs.readFile(file);
  await fs.rm(file, { force: true });
  return buffer;
}

describe("audio-split (real ffmpeg)", () => {
  let mp3: Buffer;
  let m4a: Buffer;
  let oga: Buffer;

  beforeAll(async () => {
    [mp3, m4a, oga] = await Promise.all([
      makeAudio("mp3", 10),
      makeAudio("m4a", 10),
      makeAudio("oga", 10),
    ]);
  }, 30_000);

  it("reads duration for all supported formats", async () => {
    expect(await getAudioDurationSeconds(mp3)).toBeCloseTo(10, 0);
    expect(await getAudioDurationSeconds(m4a)).toBeCloseTo(10, 0);
    expect(await getAudioDurationSeconds(oga)).toBeCloseTo(10, 0);
  });

  it("splits MP3 audio into chunks of the requested length", async () => {
    const chunks = await splitAudioIntoChunks(mp3, 4);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // each chunk is itself decodable audio
    expect(await getAudioDurationSeconds(chunks[0])).toBeGreaterThan(1);
  });

  it("splits M4A audio (regression: non-MP3 uploads over the batch threshold)", async () => {
    const chunks = await splitAudioIntoChunks(m4a, 4);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(await getAudioDurationSeconds(chunks[0])).toBeGreaterThan(1);
  });

  it("splits OGG/Opus audio (Telegram voice notes)", async () => {
    const chunks = await splitAudioIntoChunks(oga, 4);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(await getAudioDurationSeconds(chunks[0])).toBeGreaterThan(1);
  });
});
