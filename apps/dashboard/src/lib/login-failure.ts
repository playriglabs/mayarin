import { match } from "ts-pattern";
import { ApiError } from "@/lib/api/client";

export type LoginFailure =
  | { readonly type: "blocked"; readonly reason: string; readonly retryAfterSeconds: number }
  /** Right credentials, unconfirmed address. The recovery is the code form, not a retype. */
  | { readonly type: "unverified"; readonly reason: string }
  | { readonly type: "error"; readonly reason: string };

type RateLimitedApiError = ApiError & { readonly retryAfterSeconds: number };

function isRateLimitedApiError(value: unknown): value is RateLimitedApiError {
  return (
    value instanceof ApiError && value.status === 429 && typeof value.retryAfterSeconds === "number"
  );
}

/** Maps transport failures into the two recovery paths the login form supports. */
export function loginFailureOf(error: unknown): LoginFailure {
  return (
    match(error)
      .when(isRateLimitedApiError, (value) => ({
        type: "blocked" as const,
        reason: value.message,
        retryAfterSeconds: value.retryAfterSeconds,
      }))
      // Before the generic 401 arm: the API only names this reason once the
      // password has already verified, so it is not an enumeration signal — and
      // collapsing it into "invalid email or password" would send somebody to
      // retype a password that was right.
      .when(
        (value): value is ApiError =>
          value instanceof ApiError &&
          value.status === 401 &&
          value.reason === "email_not_verified",
        (value) => ({ type: "unverified" as const, reason: value.message }),
      )
      .when(
        (value): value is ApiError => value instanceof ApiError && value.status === 401,
        () => ({ type: "error" as const, reason: "Invalid email or password" }),
      )
      .when(
        (value): value is ApiError => value instanceof ApiError,
        (value) => ({ type: "error" as const, reason: value.message }),
      )
      .otherwise(() => ({ type: "error" as const, reason: "Login failed" }))
  );
}

/** Compact but explicit countdown text for both the alert and submit button. */
export function formatRetryAfter(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}
