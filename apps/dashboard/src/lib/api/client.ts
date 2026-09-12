/**
 * Centralized API client.
 *
 * Every browser request goes through `request` so the base URL, credentials, JSON
 * handling, CSRF header, and error shape live in ONE place. Domain modules
 * (`auth.ts`, `payments.ts`, ...) build on top and return `Effect`s — they never
 * call `fetch` directly. The `Effect`s are run at the React Query boundary
 * (see `run.ts`), so no Effect runtime reaches the browser bundle.
 *
 * The browser client always uses same-origin `/api`, which the Astro dev proxy
 * rewrites to the dashboard API. Server-side fetches (middleware/SSR) need an
 * absolute origin instead — see `origin.ts`.
 */

import { Data, Effect } from "effect";
import { dashboardErrorMessage } from "./error-message";

/** Typed failure for any non-2xx response, network error, or parse error. */
export class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number;
  readonly message: string;
  readonly retryAfterSeconds?: number;
  /**
   * The API's machine-readable `details.reason`, when it names one.
   *
   * Some failures are the same status with different recoveries — a `401` for
   * bad credentials is a retype, a `401` for an unconfirmed address is a trip
   * to the code form — and the human message is not something a UI should
   * branch on.
   */
  readonly reason?: string;
}> {}

/** Browser base path: same-origin, proxied to the dashboard API in dev. */
const BASE = "/api/v1";

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
      const retryAfterSeconds = extractRetryAfterSeconds(data, res.headers.get("retry-after"));
      const reason = extractReason(data);
      return yield* new ApiError({
        status: res.status,
        message,
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        ...(reason === undefined ? {} : { reason }),
      });
    }

    return data as A;
  });
}

/** Pulls `error.details.reason` out of the dashboard API's error body, when present. */
function extractReason(data: unknown): string | undefined {
  if (data === null || typeof data !== "object" || !("error" in data)) return undefined;
  const error = (data as { error: unknown }).error;
  if (error === null || typeof error !== "object" || !("details" in error)) return undefined;
  const details = (error as { details: unknown }).details;
  if (details === null || typeof details !== "object" || !("reason" in details)) return undefined;
  const reason = (details as { reason: unknown }).reason;
  return typeof reason === "string" ? reason : undefined;
}

/** Pulls the human message out of the dashboard API's `{ error: { message } }` body. */
function extractMessage(data: unknown, status: number): string {
  return dashboardErrorMessage(data, status);
}

/** Reads the API's numeric retry guidance, preferring its structured body. */
function extractRetryAfterSeconds(
  data: unknown,
  retryAfterHeader: string | null,
): number | undefined {
  if (data !== null && typeof data === "object" && "error" in data) {
    const error = (data as { error: unknown }).error;
    if (error !== null && typeof error === "object" && "details" in error) {
      const details = (error as { details: unknown }).details;
      if (details !== null && typeof details === "object" && "retryAfterSeconds" in details) {
        const seconds = (details as { retryAfterSeconds: unknown }).retryAfterSeconds;
        if (typeof seconds === "number" && Number.isInteger(seconds) && seconds > 0) return seconds;
      }
    }
  }

  if (retryAfterHeader === null) return undefined;
  const seconds = Number(retryAfterHeader);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined;
}
