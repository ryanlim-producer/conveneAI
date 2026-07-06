import { getDb, newId } from "./db";

export type JobStatus =
  | "queued"
  | "transcribing"
  | "processing_action_items"
  | "done"
  | "error";

export type JobSource = "desktop" | "telegram" | "web_upload";

export interface Job {
  id: string;
  userId: string;
  recordingId: string | null;
  status: JobStatus;
  source: JobSource;
  s3Key: string | null;
  filename: string;
  language: string;
  errorMessage: string | null;
  modelUsed: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

const MAX_ATTEMPTS = 2;

interface JobRow {
  id: string;
  user_id: string;
  recording_id: string | null;
  status: JobStatus;
  source: JobSource;
  s3_key: string | null;
  filename: string;
  language: string;
  error_message: string | null;
  model_used: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    userId: row.user_id,
    recordingId: row.recording_id,
    status: row.status,
    source: row.source,
    s3Key: row.s3_key,
    filename: row.filename,
    language: row.language,
    errorMessage: row.error_message,
    modelUsed: row.model_used,
    attempts: row.attempts,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function enqueueJob(input: {
  id?: string;
  userId: string;
  filename: string;
  s3Key: string;
  source: JobSource;
  language?: string;
}): Job {
  const db = getDb();
  const id = input.id ?? newId();
  db.prepare(
    `INSERT INTO jobs (id, user_id, status, source, s3_key, filename, language)
     VALUES (?, ?, 'queued', ?, ?, ?, ?)`,
  ).run(id, input.userId, input.source, input.s3Key, input.filename, input.language ?? "es");
  return getJob(id)!;
}

export function getJob(id: string, userId?: string): Job | null {
  const db = getDb();
  const row = (
    userId
      ? db.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(id, userId)
      : db.prepare("SELECT * FROM jobs WHERE id = ?").get(id)
  ) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function listJobs(userId: string): Job[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as JobRow[];
  return rows.map(toJob);
}

export function updateJob(
  id: string,
  fields: Partial<{
    status: JobStatus;
    recordingId: string | null;
    errorMessage: string | null;
    modelUsed: string;
    s3Key: string;
  }>,
): void {
  const db = getDb();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (fields.status !== undefined) {
    sets.push("status = ?");
    values.push(fields.status);
    if (fields.status === "done" || fields.status === "error") {
      sets.push("completed_at = datetime('now')");
    }
  }
  if (fields.recordingId !== undefined) {
    sets.push("recording_id = ?");
    values.push(fields.recordingId);
  }
  if (fields.errorMessage !== undefined) {
    sets.push("error_message = ?");
    values.push(fields.errorMessage);
  }
  if (fields.modelUsed !== undefined) {
    sets.push("model_used = ?");
    values.push(fields.modelUsed);
  }
  if (fields.s3Key !== undefined) {
    sets.push("s3_key = ?");
    values.push(fields.s3Key);
  }
  if (sets.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export type JobProcessor = (job: Job) => Promise<void>;

/**
 * Claims the oldest queued job and runs the processor on it.
 * The processor owns intermediate status transitions; this wrapper owns
 * claiming (attempts + started_at) and the retry-once-then-error policy.
 * Returns false when nothing was queued.
 */
export async function processNextQueuedJob(processor: JobProcessor): Promise<boolean> {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1")
    .get() as JobRow | undefined;
  if (!row) return false;

  db.prepare(
    "UPDATE jobs SET attempts = attempts + 1, started_at = datetime('now') WHERE id = ?",
  ).run(row.id);
  const job = getJob(row.id)!;

  try {
    await processor(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Job ${job.id} failed (attempt ${job.attempts}):`, message);
    if (job.attempts >= MAX_ATTEMPTS) {
      updateJob(job.id, { status: "error", errorMessage: message });
    } else {
      updateJob(job.id, { status: "queued" });
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// In-process worker (started once from instrumentation.ts on server boot)

let workerTimer: ReturnType<typeof setInterval> | null = null;
let draining = false;

/** Processes queued jobs until the queue is empty (chain-trigger, one at a time). */
export async function drainQueue(processor: JobProcessor): Promise<void> {
  if (draining) return; // mutex: single job at a time
  draining = true;
  try {
    while (await processNextQueuedJob(processor)) {
      // keep going until queue is empty
    }
  } finally {
    draining = false;
  }
}

export function startQueueWorker(processor: JobProcessor, pollMs = 5000): void {
  if (workerTimer) return;
  console.log(`Queue worker started (poll every ${pollMs}ms)`);
  workerTimer = setInterval(() => {
    drainQueue(processor).catch((err) => console.error("Queue worker error:", err));
  }, pollMs);
  // Pick up anything that survived a restart right away
  drainQueue(processor).catch((err) => console.error("Queue worker error:", err));
}

export function stopQueueWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("Queue worker stopped");
  }
}
