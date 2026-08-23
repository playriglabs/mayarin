/** Compact, recovery-focused copy for errors shown across the dashboard. */

const COMPACT_ERROR_BY_CODE: Readonly<Record<string, string>> = {
  PROVIDER_ERROR: "A connected service could not complete this request. Try again.",
  CONFIGURATION_ERROR: "This feature is not configured yet.",
  INTERNAL_ERROR: "Something went wrong. Try again.",
  LEDGER_IMBALANCE: "Payment records are temporarily unavailable. Try again.",
  CONCURRENCY_CONFLICT: "This record changed. Refresh and try again.",
  IDEMPOTENCY_CONFLICT: "This request changed after submission. Try again.",
  RATE_LIMIT_EXCEEDED: "Too many requests. Wait a moment and try again.",
} as const;

const MAX_VISIBLE_MESSAGE_LENGTH = 120;
const FALLBACK_MESSAGE = "The request could not be completed. Please try again.";

interface ErrorPayload {
  readonly code?: string;
  readonly message?: string;
}

export function dashboardErrorMessage(data: unknown, status: number): string {
  const error = errorPayloadOf(data);
  if (error === undefined) return `Request failed (${status})`;

  const compact = error.code === undefined ? undefined : COMPACT_ERROR_BY_CODE[error.code];
  if (compact !== undefined) return compact;

  const message = error.message?.replace(/\s+/g, " ").trim();
  if (message === undefined || message === "") return `Request failed (${status})`;
  return message.length <= MAX_VISIBLE_MESSAGE_LENGTH ? message : FALLBACK_MESSAGE;
}

function errorPayloadOf(data: unknown): ErrorPayload | undefined {
  if (data === null || typeof data !== "object" || !("error" in data)) return undefined;
  const error = (data as { readonly error: unknown }).error;
  if (error === null || typeof error !== "object") return undefined;

  const value = error as { readonly code?: unknown; readonly message?: unknown };
  return {
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}
