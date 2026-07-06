import { drainQueue, startQueueWorker, stopQueueWorker, type Job } from "./queue";

// The pipeline is imported lazily so that route modules depending on the
// worker don't pull Deepgram/LLM/ffmpeg code into their bundle.
async function pipelineProcessor(job: Job): Promise<void> {
  const { processJob } = await import("./pipeline");
  await processJob(job);
}

/** Fire-and-forget: process any queued jobs now (called after each upload). */
export function nudgeWorker(): void {
  drainQueue(pipelineProcessor).catch((err) =>
    console.error("Queue drain error:", err),
  );
}

/** Started once from instrumentation.ts on server boot. */
export function startWorker(pollMs?: number): void {
  startQueueWorker(pipelineProcessor, pollMs);
}

export function stopWorker(): void {
  stopQueueWorker();
}
