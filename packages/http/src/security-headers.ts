/**
 * Response headers for a JSON API (SEC-08).
 *
 * A JSON response has no use for scripts, frames, referrers or sniffing, so the
 * policy is "none of it": a browser that is tricked into rendering one gets an
 * empty document. This is for API routes only — a hosted HTML page needs its
 * own, looser policy and must not be mounted behind this one.
 */

import type { MiddlewareHandler } from "hono";

const HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "cross-origin-resource-policy": "cross-origin",
};

export function apiSecurityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(HEADERS)) c.header(name, value);
  };
}
