import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/** Reads the audio duration via ffprobe. Returns 0 if it can't be determined. */
export async function getAudioDurationSeconds(audio: Buffer): Promise<number> {
  const tmpFile = path.join(os.tmpdir(), `conveneai-probe-${Date.now()}.audio`);
  try {
    await fs.writeFile(tmpFile, audio);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      tmpFile,
    ]);
    const duration = parseFloat(stdout.trim());
    return Number.isFinite(duration) ? duration : 0;
  } catch (err) {
    console.error("ffprobe duration check failed:", err);
    return 0;
  } finally {
    await fs.rm(tmpFile, { force: true });
  }
}

/**
 * Splits audio into chunks of chunkSeconds via ffmpeg segment mode.
 * Chunks are transcoded to MP3 rather than stream-copied: the input can be
 * any supported format (m4a/ogg/wav/...), and codec-copying those into .mp3
 * segment files fails outright.
 */
export async function splitAudioIntoChunks(
  audio: Buffer,
  chunkSeconds = 1800,
): Promise<Buffer[]> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "conveneai-split-"));
  const inputFile = path.join(workDir, "input.audio"); // ffmpeg sniffs the container
  try {
    await fs.writeFile(inputFile, audio);
    await execFileAsync("ffmpeg", [
      "-i", inputFile,
      "-f", "segment",
      "-segment_time", String(chunkSeconds),
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      path.join(workDir, "chunk_%03d.mp3"),
    ]);

    const chunkNames = (await fs.readdir(workDir))
      .filter((f) => f.startsWith("chunk_"))
      .sort();
    return Promise.all(chunkNames.map((name) => fs.readFile(path.join(workDir, name))));
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

/**
 * Convert any audio format to MP3 using the server's ffmpeg.
 * This is critical for WAV files — uncompressed WAV is ~10x larger than MP3,
 * and uploading it to Deepgram often triggers 408 SLOW_UPLOAD timeouts.
 *
 * If ffmpeg is unavailable, returns the original buffer unchanged so the
 * pipeline can still attempt transcription with the raw audio.
 */
export async function convertAudioToMp3(
  audio: Buffer,
  bitrateBps = 128_000,
): Promise<Buffer> {
  // Quick check: if it already looks like MP3, skip conversion
  if (
    audio.length >= 3 &&
    audio[0] === 0xFF && (audio[1] & 0xE0) === 0xE0 // sync word
  ) {
    return audio;
  }
  // ID3 tag at start (MP3 with metadata)
  if (
    audio.length >= 3 &&
    audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33
  ) {
    return audio;
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "conveneai-convert-"));
  const inputFile = path.join(workDir, "input.audio");
  const outputFile = path.join(workDir, "output.mp3");

  try {
    await fs.writeFile(inputFile, audio);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", inputFile,
      "-c:a", "libmp3lame",
      "-b:a", `${Math.floor(bitrateBps / 1000)}k`,
      "-ac", "2",
      outputFile,
    ]);
    const result = await fs.readFile(outputFile);
    console.log(
      `Audio converted: ${(audio.length / 1024).toFixed(0)}KB → ${(result.length / 1024).toFixed(0)}KB MP3`,
    );
    return result;
  } catch (err) {
    console.error("Audio conversion to MP3 failed, using original buffer:", err);
    return audio; // fall back to original buffer
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
