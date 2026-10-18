/**
 * Structured security events (SEC-22).
 *
 * One JSON line per request that changes something or is turned away, so a log
 * drain can alert on credential stuffing, refused access and custody changes
 * without parsing free text. Redacted by construction: the event is built from
 * the method, the route *template*, the status and two caller-supplied ids.
 * Query strings, bodies, headers and path parameters are never read, so a
 * session, API key, webhook secret or payment id cannot reach the log.
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
}

export interface SecurityEventOptions {
  readonly service: string;
  /** Who made the request, read after the handler so auth middleware has run. */
  readonly identify: (c: Context) => { readonly actor?: string; readonly tenant?: string };
  readonly now?: () => Date;
  readonly write?: (event: SecurityEvent) => void;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function resultOf(status: number): SecurityEvent["result"] {
  if (status < 400) return "success";
  return status === 401 || status === 403 || status === 429 ? "denied" : "error";
}

export function securityEvents(options: SecurityEventOptions): MiddlewareHandler {
  const now = options.now ?? (() => new Date());
  const write = options.write ?? ((event) => console.log(JSON.stringify(event)));

  return async (c, next) => {
    // Cloudflare's id when present, so a log line joins the edge log.
    const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
    c.header("x-request-id", requestId);
    await next();

    const status = c.res.status;
    const result = resultOf(status);
    if (READ_METHODS.has(c.req.method) && result !== "denied") return;

    const { actor, tenant } = options.identify(c);
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
    });
  };
}
