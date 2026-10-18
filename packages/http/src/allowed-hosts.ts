/**
 * Host allowlist (SEC-13).
 *
 * The generated Railway domain reaches the same service as the Cloudflare
 * hostname but skips Cloudflare's WAF, rate limits and bot policy. Refusing any
 * request whose `Host` is not one of the public names closes that path from the
 * application side: a direct hit on the origin domain gets a 404 without
 * touching a route.
 *
 * An empty list turns the check off, so local development and tests need no
 * configuration. `Host` is client-supplied, so this is not authentication: it
 * stops the accidental and unsophisticated path, and an attacker who sends the
 * right header to the origin is still only as capable as before. Closing the
 * origin properly (no public domain, or Tunnel/mTLS) is the platform's job.
 */

import type { MiddlewareHandler } from "hono";

export interface AllowedHostsOptions {
  /** Hostnames without port, compared case-insensitively. */
  readonly hosts: readonly string[];
  /** Paths answered whatever the host: the platform's own health probe has an internal one. */
  readonly exemptPaths?: readonly string[];
}

export function allowedHosts(options: AllowedHostsOptions): MiddlewareHandler {
  const hosts = new Set(options.hosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  const exempt = new Set(options.exemptPaths ?? ["/health"]);

  return async (c, next) => {
    if (hosts.size === 0 || exempt.has(c.req.path)) return next();
    const host = (c.req.header("host") ?? "").toLowerCase().replace(/:\d+$/, "");
    if (!hosts.has(host))
      return c.json({ error: { code: "NOT_FOUND", message: "Not found" } }, 404);
    return next();
  };
}

/** `ALLOWED_HOSTS` is a comma-separated list; blank entries are dropped. */
export function parseHostList(value: string): string[] {
  return value
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
}
