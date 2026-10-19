/**
 * Origin authentication (SEC-13).
 *
 * The generated Railway domain reaches the same service as the public hostname
 * but skips Cloudflare's WAF, rate limits and bot policy, and a `Host` allowlist
 * stops only a request that does not bother to send the right header. What
 * stops the rest is a secret that only the edge adds: Cloudflare (a request
 * header Transform Rule) and our own Workers send `x-origin-secret`, and the
 * service answers 404 to a request without it, as it would a path it does not
 * have.
 *
 * Unset turns the check off, so local development and tests need nothing, and a
 * rollout can set the secret at the edge before it is required at the origin.
 * The health probe is exempt: the platform calls it directly.
 */

import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const ORIGIN_SECRET_HEADER = "x-origin-secret";

export interface OriginSecretOptions {
  readonly secret: string | undefined;
  readonly exemptPaths?: readonly string[];
}

export function originSecret(options: OriginSecretOptions): MiddlewareHandler {
  const expected = options.secret === undefined ? undefined : Buffer.from(options.secret);
  const exempt = new Set(options.exemptPaths ?? ["/health"]);

  return async (c, next) => {
    if (expected === undefined || exempt.has(c.req.path)) return next();
    const presented = Buffer.from(c.req.header(ORIGIN_SECRET_HEADER) ?? "");
    // Equal lengths first: `timingSafeEqual` throws on unequal ones, and the
    // length of a secret is not what this protects.
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    }
    return next();
  };
}
