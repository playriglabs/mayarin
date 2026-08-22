import { match } from "ts-pattern";
import { ApiError } from "@/lib/api/client";

export type LoginFailure =
  | { readonly type: "blocked"; readonly reason: string; readonly retryAfterSeconds: number }
  | { readonly type: "error"; readonly reason: string };

type RateLimitedApiError = ApiError & { readonly retryAfterSeconds: number };

function isRateLimitedApiError(value: unknown): value is RateLimitedApiError {
  return (
    value instanceof ApiError && value.status === 429 && typeof value.retryAfterSeconds === "number"
  );
}

/** Maps transport failures into the two recovery paths the login form supports. */
export function loginFailureOf(error: unknown): LoginFailure {
  return match(error)
    .when(isRateLimitedApiError, (value) => ({
      type: "blocked" as const,
      reason: value.message,
      retryAfterSeconds: value.retryAfterSeconds,
    }))
    .when(
      (value): value is ApiError => value instanceof ApiError && value.status === 401,
      () => ({ type: "error" as const, reason: "Invalid email or password" }),
    )
    .when(
      (value): value is ApiError => value instanceof ApiError,
      (value) => ({ type: "error" as const, reason: value.message }),
    )
    .otherwise(() => ({ type: "error" as const, reason: "Login failed" }));
}

/** Compact but explicit countdown text for both the alert and submit button. */
export function formatRetryAfter(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
