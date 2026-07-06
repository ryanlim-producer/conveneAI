// Next.js lifecycle hook — runs once when the server boots.
// Starts the in-process job queue worker so queued jobs survive restarts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startWorker, stopWorker } = await import("./lib/worker");
    startWorker();
    process.on("SIGTERM", stopWorker);
  }
}
