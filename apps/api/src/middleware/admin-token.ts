/**
 * Admin token middleware (SEC-14).
 *
 * Guards the admin route group with a static bearer token. The token is compared
 * in constant time, and every call, allowed or denied, is recorded before the
 * handler runs: if the record cannot be written the call does not happen.
 *
 * Throws `UnauthorizedError` so the single error handler maps it to a 401 with
 * the `UNAUTHORIZED` code — the same taxonomy every other failure uses.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { AdminAuditRepository } from "@mayarin/db";
import { clientId } from "@mayarin/http";
import { type Clock, generateId, UnauthorizedError } from "@mayarin/shared";
import type { MiddlewareHandler } from "hono";
import type { Config } from "../config.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();

export function adminTokenMiddleware(options: {
  readonly token: string;
  readonly audit: AdminAuditRepository;
  readonly clock: Clock;
  readonly clientIpSource: Config["rateLimitClientIpSource"];
}): MiddlewareHandler {
  const expected = digest(options.token);

  return async (c, next) => {
    const header = c.req.header("authorization");
    const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    // Hashing first makes both sides 32 bytes, so the comparison does not leak
    // the token's length either.
    const allowed = presented !== undefined && timingSafeEqual(digest(presented), expected);
    const now = options.clock.now();

    await options.audit.record({
      id: generateId("aud", now.getTime()),
      occurredAt: now,
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      outcome: allowed ? "allowed" : "denied",
      sourceIp: clientId(c, options.clientIpSource),
      tokenFingerprint:
        presented === undefined ? null : digest(presented).toString("hex").slice(0, 12),
    });

    if (!allowed) throw new UnauthorizedError("Invalid admin token");
    await next();
  };
}
