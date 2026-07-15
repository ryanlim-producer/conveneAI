import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getAudioDurationSeconds, splitAudioIntoChunks, convertAudioToMp3 } from "@/lib/audio-split";

const execFileAsync = promisify(execFile);

// These run the real ffmpeg/ffprobe binaries — they're a hard runtime
// dependency of the pipeline, so testing against them is the honest seam.

async function makeAudio(format: "mp3" | "m4a" | "oga", seconds: number): Promise<Buffer> {
  const codec = { mp3: "libmp3lame", m4a: "aac", oga: "libopus" }[format];
  const file = path.join(os.tmpdir(), `conveneai-split-test-${Date.now()}.${format}`);
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

describe("convertAudioToMp3 (real ffmpeg)", () => {
  it("converts WAV to MP3, shrinking size", async () => {
    // Generate a short WAV file via ffmpeg
    const wavFile = path.join(os.tmpdir(), `conveneai-wav-${Date.now()}.wav`);
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi",
      "-i", "sine=frequency=440:duration=3",
      "-c:a", "pcm_s16le",
      wavFile,
    ]);
    const wav = await fs.readFile(wavFile);
    await fs.rm(wavFile, { force: true });

    const result = await convertAudioToMp3(wav);
    // MP3 should be significantly smaller than uncompressed WAV
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(wav.length * 0.5);
    // Verify it's valid MP3 by checking duration
    expect(await getAudioDurationSeconds(result)).toBeCloseTo(3, 0);
  });

  it("passes through MP3 unchanged", async () => {
    const testFile = path.join(os.tmpdir(), `conveneai-mp3-${Date.now()}.mp3`);
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi",
      "-i", "sine=frequency=440:duration=2",
      "-c:a", "libmp3lame", "-b:a", "128k",
      testFile,
    ]);
    const mp3 = await fs.readFile(testFile);
    await fs.rm(testFile, { force: true });

    const result = await convertAudioToMp3(mp3);
    // Should return the same bytes for an already-MP3 input
    expect(result).toEqual(mp3);
  });
});
