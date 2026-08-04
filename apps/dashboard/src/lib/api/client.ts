/**
 * Centralized API client.
 *
 * Every browser request goes through `request` so the base URL, credentials, JSON
 * handling, CSRF header, and error shape live in ONE place. Domain modules
 * (`auth.ts`, `payments.ts`, ...) build on top and return `Effect`s — they never
 * call `fetch` directly. The `Effect`s are run at the React Query boundary
 * (see `run.ts`), so no Effect runtime reaches the browser bundle.
 *
 * Server-side fetches (middleware/SSR) need an absolute origin — a relative
 * `/api` only resolves in the browser — so `getApiBase` resolves it from the
 * runtime/build-time env with a dev fallback. The browser client always uses
 * same-origin `/api`, which the Astro dev proxy rewrites to the dashboard API.
 */

import type { APIContext } from "astro";
import { Data, Effect } from "effect";

type AnyContext = APIContext;

/**
 * Absolute base URL of the dashboard API, for SERVER-side fetches only.
 *
 * Resolution order:
 *   1. Edge runtime binding/secret (a future `locals.runtime.env.API_URL`)
 *   2. Build-time env                       (`import.meta.env.DASHBOARD_API_URL`)
 *   3. Dev fallback                         (dashboard API on :3001)
 */
export function getApiBase(context?: AnyContext): string {
  const runtime = (context?.locals as { runtime?: { env?: { API_URL?: string } } } | undefined)
    ?.runtime;
  return (
    runtime?.env?.API_URL ??
    (import.meta.env.DASHBOARD_API_URL as string | undefined) ??
    "http://localhost:3001"
  );
}

/** Typed failure for any non-2xx response, network error, or parse error. */
export class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number;
  readonly message: string;
}> {}

/** Browser base path: same-origin, proxied to the dashboard API in dev. */
const BASE = "/api";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Reads the double-submit CSRF token from the non-httpOnly cookie. */
function readCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(/(?:^|;\s*)mayarin_csrf=([^;]+)/);
  return match?.[1];
}

export interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  /** Extra headers (e.g. an explicit `X-CSRF-Token` override). */
  readonly headers?: Record<string, string>;
}

/**
 * Performs a JSON request and returns the parsed body as `A`, or fails with
 * `ApiError`. Mutating methods auto-attach the CSRF token from the cookie.
 */
export function request<A>(path: string, opts: RequestOptions = {}): Effect.Effect<A, ApiError> {
  const method = opts.method ?? "GET";
  return Effect.gen(function* () {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (MUTATING.has(method.toUpperCase())) {
      const token = readCsrfToken();
      if (token !== undefined) headers["x-csrf-token"] = token;
    }

    const res = yield* Effect.tryPromise({
      try: (signal) =>
        fetch(`${BASE}${path}`, {
          method,
          credentials: "same-origin",
          headers,
          signal,
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        }),
      catch: () => new ApiError({ status: 0, message: "Network error" }),
    });

    const text = yield* Effect.tryPromise({
      try: () => res.text(),
      catch: () => new ApiError({ status: res.status, message: "Failed to read response" }),
    });

    const data = yield* Effect.try({
      try: (): unknown => (text === "" ? undefined : JSON.parse(text)),
      catch: () => new ApiError({ status: res.status, message: "Invalid JSON response" }),
    });

    if (!res.ok) {
      const message = extractMessage(data, res.status);
      return yield* new ApiError({ status: res.status, message });
    }

    return data as A;
  });
}

/** Pulls the human message out of the dashboard API's `{ error: { message } }` body. */
function extractMessage(data: unknown, status: number): string {
  if (data !== null && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (err !== null && typeof err === "object" && "message" in err) {
      return String((err as { message: unknown }).message);
    }
  }
  return `Request failed (${status})`;
}
