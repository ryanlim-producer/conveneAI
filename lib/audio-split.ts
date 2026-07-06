import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/** Reads the audio duration via ffprobe. Returns 0 if it can't be determined. */
export async function getAudioDurationSeconds(audio: Buffer): Promise<number> {
  const tmpFile = path.join(os.tmpdir(), `asisvoz-probe-${Date.now()}.audio`);
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

/** Splits audio into chunks of chunkSeconds via ffmpeg segment mode (stream copy). */
export async function splitAudioIntoChunks(
  audio: Buffer,
  chunkSeconds = 1800,
): Promise<Buffer[]> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "asisvoz-split-"));
  const inputFile = path.join(workDir, "input.mp3");
  try {
    await fs.writeFile(inputFile, audio);
    await execFileAsync("ffmpeg", [
      "-i", inputFile,
      "-f", "segment",
      "-segment_time", String(chunkSeconds),
      "-c", "copy",
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
