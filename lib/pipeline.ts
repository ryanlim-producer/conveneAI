import { getDb, newId } from "./db";
import { decrypt } from "./crypto";
import { getAudioBuffer } from "./s3";
import { transcribeAudio, type TranscriptionResult } from "./deepgram";
import { detectSpeakerNames } from "./name-detector";
import { extractActionItems, type ActionItem } from "./action-extractor";
import { getUserSettings } from "./settings";
import { updateJob, type Job } from "./queue";
import { getAudioDurationSeconds, splitAudioIntoChunks, convertAudioToMp3 } from "./audio-split";
import { mergeChunkResults, normalizeSpeakersByName } from "./batch-merge";

// Files longer than this are split into chunks of this size before Deepgram.
const BATCH_THRESHOLD_SECONDS = 30 * 60;

function getDeepgramKey(userId: string): string {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT encrypted_key FROM api_keys WHERE user_id = ? AND provider = 'deepgram'",
    )
    .get(userId) as { encrypted_key: string } | undefined;

  if (row) return decrypt(row.encrypted_key);
  if (process.env.DEEPGRAM_API_KEY) return process.env.DEEPGRAM_API_KEY;
  throw new Error("No Deepgram API key configured. Add your key in settings.");
}

/**
 * Runs the full transcription pipeline for one job:
 * S3 audio → Deepgram → speaker names (LLM) → action items (LLM) → recordings row.
 * Throws on hard failures (queue wrapper owns retry/error policy); LLM
 * post-processing is best-effort and never fails the job.
 */
export async function processJob(job: Job): Promise<void> {
  if (!job.s3Key) throw new Error("Job has no audio file attached.");

  const settings = getUserSettings(job.userId);
  const deepgramKey = getDeepgramKey(job.userId);

  updateJob(job.id, { status: "transcribing", modelUsed: settings.deepgramModel });

  let audio = await getAudioBuffer(job.s3Key);

  // Convert to MP3 before sending to Deepgram — uncompressed WAV is ~10x
  // larger and often triggers 408 SLOW_UPLOAD timeouts from Deepgram.
  audio = await convertAudioToMp3(audio);

  const durationSeconds = await getAudioDurationSeconds(audio);
  const isBatch = durationSeconds > BATCH_THRESHOLD_SECONDS;

  let result: TranscriptionResult;
  if (isBatch) {
    const chunks = await splitAudioIntoChunks(audio, BATCH_THRESHOLD_SECONDS);
    const chunkResults: TranscriptionResult[] = [];
    for (const chunk of chunks) {
      chunkResults.push(
        await transcribeAudio(deepgramKey, chunk, job.language, settings.deepgramModel),
      );
    }
    result = mergeChunkResults(chunkResults);
  } else {
    result = await transcribeAudio(deepgramKey, audio, job.language, settings.deepgramModel);
  }

  if (!result.fullTranscript || result.segments.length === 0) {
    throw new Error("No speech detected in the audio file.");
  }

  updateJob(job.id, { status: "processing_action_items" });

  let speakerMap: Record<string, string> = {};
  try {
    speakerMap = await detectSpeakerNames(job.userId, result.segments, settings.actionsLlmModel);
  } catch (err) {
    console.error("Name detection failed:", err);
    for (const s of new Set(result.segments.map((seg) => seg.speaker))) {
      speakerMap[`Speaker ${s}`] = `Speaker ${s}`;
    }
  }

  if (isBatch) {
    // Collapse chunk-offset speaker IDs that detected to the same real name
    const normalized = normalizeSpeakersByName(result.segments, speakerMap);
    result = {
      ...result,
      segments: normalized.segments,
      speakerCount: normalized.speakerCount,
    };
    speakerMap = normalized.speakerMap;
  }

  let actionItems: ActionItem[] = [];
  try {
    actionItems = await extractActionItems(
      job.userId,
      result.fullTranscript,
      speakerMap,
      settings.actionsLlmModel,
    );
  } catch (err) {
    console.error("Action extraction failed:", err);
  }

  const db = getDb();
  const recordingId = newId();
  db.prepare(
    `INSERT INTO recordings (
      id, user_id, job_id, filename, source, duration_seconds, speaker_count,
      s3_key, transcript_text, segments_json, speaker_map_json,
      action_items_json, model_used
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    recordingId,
    job.userId,
    job.id,
    job.filename,
    job.source,
    result.duration,
    result.speakerCount,
    job.s3Key,
    result.fullTranscript,
    JSON.stringify(result.segments),
    JSON.stringify(speakerMap),
    JSON.stringify(actionItems),
    settings.deepgramModel,
  );

  updateJob(job.id, { status: "done", recordingId });

  // Deliver action items to the user's linked Telegram chat (best effort)
  const { notifyLinkedTelegram } = await import("./telegram-bot");
  notifyLinkedTelegram(
    job.userId,
    recordingId,
    actionItems,
    result.duration,
    result.speakerCount,
  ).catch(() => {});
}
