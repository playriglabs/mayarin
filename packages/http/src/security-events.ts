/**
 * Structured security events (SEC-22).
 *
 * One JSON line per request that changes something or is turned away, so a log
 * drain can alert on credential stuffing, refused access and custody changes
 * without parsing free text. Redacted by construction: the event is built from
 * the method, the route *template*, the status and two caller-supplied ids.
 * Query strings, bodies and headers are never read, and of the path only the
 * `:id` segment is, and only when it has the shape of one of our ids
 * (`pay_01J…`). Anything else in that slot — a token, a secret pasted into a
 * URL — is dropped, so a session, API key or webhook secret cannot reach the log.
 *
 * This is the emitting half only. Shipping the lines to an immutable store and
 * alerting on them is the platform's job.
 */

import type { Context, MiddlewareHandler } from "hono";

export interface SecurityEvent {
  readonly type: "security";
  readonly time: string;
  readonly service: string;
  readonly requestId: string;
  readonly method: string;
  /** The matched route template, e.g. `/v1/payments/:id/refunds`. */
  readonly route: string;
  readonly status: number;
  /** `success` below 400, `denied` for 401/403/429, `error` otherwise. */
  readonly result: "success" | "denied" | "error";
  readonly actor?: string;
  readonly tenant?: string;
  /** The id the route acts on (`:id`), when it is one of our ids. */
  readonly target?: string;
}

export interface SecurityEventOptions {
  readonly service: string;
  /** Who made the request, read after the handler so auth middleware has run. */
  readonly identify: (c: Context) => { readonly actor?: string; readonly tenant?: string };
  readonly now?: () => Date;
  readonly write?: (event: SecurityEvent) => void;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const ID_SHAPE = /^[a-z]{2,6}_[0-9A-Za-z]{1,40}$/;

/** The value in the `:id` slot of the matched route, or `undefined` if there is none or it is not an id. */
export function targetOf(routePath: string, path: string): string | undefined {
  const slot = routePath.split("/").indexOf(":id");
  const value = slot === -1 ? undefined : path.split("/")[slot];
  return value !== undefined && ID_SHAPE.test(value) ? value : undefined;
}

export function resultOf(status: number): SecurityEvent["result"] {
  if (status < 400) return "success";
  return status === 401 || status === 403 || status === 429 ? "denied" : "error";
}

export function securityEvents(options: SecurityEventOptions): MiddlewareHandler {
  const now = options.now ?? (() => new Date());
  // Quiet under `bun test` (NODE_ENV=test): a suite exercising refusals would
  // otherwise print a line per request and bury its own failures.
  const write =
    options.write ??
    ((event) => {
      if (process.env.NODE_ENV !== "test") console.log(JSON.stringify(event));
    });

  return async (c, next) => {
    // Cloudflare's id when present, so a log line joins the edge log.
    const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
    c.header("x-request-id", requestId);
    await next();

    const status = c.res.status;
    const result = resultOf(status);
    if (READ_METHODS.has(c.req.method) && result !== "denied") return;

    const { actor, tenant } = options.identify(c);
    const target = targetOf(c.req.routePath, c.req.path);
    write({
      type: "security",
      time: now().toISOString(),
      service: options.service,
      requestId,
      method: c.req.method,
      route: c.req.routePath,
      status,
      result,
      ...(actor === undefined ? {} : { actor }),
      ...(tenant === undefined ? {} : { tenant }),
      ...(target === undefined ? {} : { target }),
    });
  };
}
