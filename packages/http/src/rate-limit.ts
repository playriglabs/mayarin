/**
 * Process-local HTTP rate limiting for the Hono applications.
 *
 * A token bucket allows short bursts up to `limit`, then refills steadily over
 * `windowMs`. This is deliberately an edge concern: domain packages never know
 * about callers, proxies, HTTP headers, or mutable request counters.
 */

import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";

const DEFAULT_MAX_CLIENTS = 10_000;
const OVERFLOW_CLIENT = "__rate_limit_overflow__";

interface Bucket {
  readonly tokens: number;
  readonly lastRefillMs: number;
  readonly lastSeenMs: number;
  readonly blockedUntilMs: number;
}

interface Consumption {
  readonly allowed: boolean;
  readonly bucket: Bucket;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
  readonly resetAfterSeconds: number;
}

export interface RateLimitOptions {
  /** Requests available in a full bucket. */
  readonly limit: number;
  /** Time in milliseconds to refill an empty bucket completely. */
  readonly windowMs: number;
  /** Source of the client identity, selected for the deployment's trusted proxy. */
  readonly clientIpSource: ClientIpSource;
  /** Fixed penalty after the bucket is exhausted. Retries do not extend it. */
  readonly blockDurationMs?: number;
  /** Bounds per-process memory when many distinct clients arrive. */
  readonly maxClients?: number;
  /** Injectable monotonic-enough wall clock for deterministic tests. */
  readonly now?: () => number;
}

export type ClientIpSource = "cf-connecting-ip" | "socket" | "x-forwarded-for" | "x-real-ip";

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  const maxClients = options.maxClients ?? DEFAULT_MAX_CLIENTS;
  const blockDurationMs = options.blockDurationMs ?? 0;
  const bucketRetentionMs = Math.max(options.windowMs * 2, blockDurationMs);
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();
  let nextCleanupMs = 0;

  return async (c, next) => {
    if (c.req.method === "OPTIONS") {
      await next();
      return;
    }

    const currentMs = now();
    if (currentMs >= nextCleanupMs) {
      pruneIdleBuckets(buckets, currentMs - bucketRetentionMs);
      nextCleanupMs = currentMs + options.windowMs;
    }

    const client = clientId(c, options.clientIpSource);
    const key = buckets.has(client) || buckets.size < maxClients ? client : OVERFLOW_CLIENT;
    const consumed = consume(
      buckets.get(key),
      currentMs,
      options.limit,
      options.windowMs,
      blockDurationMs,
    );
    buckets.set(key, consumed.bucket);

    c.header("RateLimit-Limit", String(options.limit));
    c.header("RateLimit-Remaining", String(consumed.remaining));
    c.header("RateLimit-Reset", String(consumed.resetAfterSeconds));

    if (!consumed.allowed) {
      c.header("Retry-After", String(consumed.retryAfterSeconds));
      return c.json(
        {
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests. Try again later.",
            retryable: true,
            details: { retryAfterSeconds: consumed.retryAfterSeconds },
          },
        },
        429,
      );
    }

    await next();
  };
}

function consume(
  previous: Bucket | undefined,
  nowMs: number,
  limit: number,
  windowMs: number,
  blockDurationMs: number,
): Consumption {
  if (previous !== undefined && previous.blockedUntilMs > nowMs) {
    const retryAfterSeconds = Math.ceil((previous.blockedUntilMs - nowMs) / 1_000);
    return {
      allowed: false,
      bucket: { ...previous, lastSeenMs: nowMs },
      remaining: 0,
      retryAfterSeconds,
      resetAfterSeconds: retryAfterSeconds,
    };
  }

  const elapsedMs = previous === undefined ? 0 : Math.max(0, nowMs - previous.lastRefillMs);
  const available =
    previous === undefined
      ? limit
      : Math.min(limit, previous.tokens + elapsedMs * (limit / windowMs));
  const allowed = available >= 1;
  const tokens = allowed ? available - 1 : available;
  const refillPerMs = limit / windowMs;
  const blockedUntilMs = !allowed && blockDurationMs > 0 ? nowMs + blockDurationMs : 0;
  const tokenRetryAfterSeconds = Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1_000));
  const retryAfterSeconds =
    blockedUntilMs > nowMs ? Math.ceil(blockDurationMs / 1_000) : tokenRetryAfterSeconds;
  const tokenResetAfterSeconds = Math.ceil((limit - tokens) / refillPerMs / 1_000);

  return {
    allowed,
    bucket: { tokens, lastRefillMs: nowMs, lastSeenMs: nowMs, blockedUntilMs },
    remaining: Math.floor(tokens),
    retryAfterSeconds: allowed ? 0 : retryAfterSeconds,
    resetAfterSeconds: blockedUntilMs > nowMs ? retryAfterSeconds : tokenResetAfterSeconds,
  };
}

function clientId(c: Context, source: ClientIpSource): string {
  const fromProxy = proxyClientId(c, source);
  if (fromProxy !== undefined) return fromProxy;

  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    // Hono's in-process `app.request` has no Bun server object. Group those
    // calls safely instead of making tests and embedded consumers supply one.
    return "unknown";
  }
}

function proxyClientId(c: Context, source: ClientIpSource): string | undefined {
  if (source === "socket") return undefined;

  const header = c.req.header(source);
  const address = source === "x-forwarded-for" ? header?.split(",")[0]?.trim() : header?.trim();
  return address === undefined || address === "" ? undefined : address.slice(0, 128);
}

function pruneIdleBuckets(buckets: Map<string, Bucket>, oldestAllowedMs: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.lastSeenMs < oldestAllowedMs) buckets.delete(key);
  }
}
