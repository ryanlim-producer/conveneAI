import { NextResponse } from "next/server";

/**
 * Server-sent events response that emits the snapshot immediately, then
 * re-emits whenever its serialized form changes (polled every intervalMs).
 *
 * Deployment note: nginx must have `proxy_buffering off;` on this location
 * (see README) or events sit in the proxy buffer until the connection closes.
 */
export function sseResponse<T>(
  snapshot: () => T,
  opts: { intervalMs?: number } = {},
): NextResponse {
  const encoder = new TextEncoder();
  const intervalMs = opts.intervalMs ?? 2000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastPayload = "";

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          const payload = JSON.stringify(snapshot());
          if (payload !== lastPayload) {
            lastPayload = payload;
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
          } else {
            // heartbeat comment keeps proxies from timing out the connection
            controller.enqueue(encoder.encode(`: keep-alive\n\n`));
          }
        } catch (err) {
          console.error("SSE snapshot error:", err);
          if (timer) clearInterval(timer);
          controller.close();
        }
      };
      send();
      timer = setInterval(send, intervalMs);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
