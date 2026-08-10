import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

const REFRESH_INTERVAL_MS = 3_000;

export function refreshStream(c: Context, channel: string): Response {
  return streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });

    while (!closed) {
      await stream.writeSSE({ event: "refresh", data: channel });
      await stream.sleep(REFRESH_INTERVAL_MS);
    }
  });
}
