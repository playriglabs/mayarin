/**
 * A log line for each request that took a long time.
 *
 * `securityEvents` writes a line only for a request that changes something or is turned
 * away, so a slow read never reaches the log and "the dashboard is slow" has nothing to
 * be traced to. This writes one line for any request over a threshold, with how long it
 * took, and nothing else about it: the method, the route *template* and the status, never
 * a path value, query string, header or body, by the same rule as `securityEvents`.
 *
 * A server-sent-events stream is open for as long as the page is, so it is skipped:
 * its "duration" is the length of a visit, not slowness.
 */

import type { MiddlewareHandler } from "hono";

export interface SlowRequestEvent {
  readonly type: "slow-request";
  readonly time: string;
  readonly service: string;
  readonly requestId: string;
  readonly method: string;
  /** The matched route template, e.g. `/v1/wallets/rails`. */
  readonly route: string;
  readonly status: number;
  readonly durationMs: number;
}

export interface SlowRequestOptions {
  readonly service: string;
  /** Requests at or over this are logged. Defaults to one second. */
  readonly thresholdMs?: number;
  readonly now?: () => Date;
  /** Milliseconds from an arbitrary origin; replaceable so a test need not sleep. */
  readonly clock?: () => number;
  readonly write?: (event: SlowRequestEvent) => void;
}

export function slowRequests(options: SlowRequestOptions): MiddlewareHandler {
  const threshold = options.thresholdMs ?? 1_000;
  const now = options.now ?? (() => new Date());
  const clock = options.clock ?? (() => performance.now());
  const write =
    options.write ??
    ((event) => {
      if (process.env.NODE_ENV !== "test") console.log(JSON.stringify(event));
    });

  return async (c, next) => {
    const started = clock();
    await next();

    const durationMs = Math.round(clock() - started);
    if (durationMs < threshold) return;
    if (c.res.headers.get("content-type")?.startsWith("text/event-stream")) return;

    write({
      type: "slow-request",
      time: now().toISOString(),
      service: options.service,
      requestId: c.res.headers.get("x-request-id") ?? "",
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      durationMs,
    });
  };
}
