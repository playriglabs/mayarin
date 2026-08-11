/**
 * The one error type the SDK throws.
 *
 * Every failure — an API error body, a non-JSON response, a network fault —
 * surfaces as a `MayarinApiError` with a stable `code` and a `retryable`
 * flag, mirroring the server taxonomy in `packages/shared/src/errors.ts`.
 * The `code` is the contract; the message is for humans.
 */

import type { ErrorBody } from "@mayarin/api/dto";

/** The request never produced an API response (DNS, refused, aborted). */
export const NETWORK_ERROR = "NETWORK_ERROR";
/** The response was not the JSON the API contract promises. */
export const INVALID_RESPONSE = "INVALID_RESPONSE";

export class MayarinApiError extends Error {
  readonly code: string;
  /** HTTP status of the response, or 0 when no response arrived. */
  readonly status: number;
  /** Whether retrying the same request unchanged can succeed later. */
  readonly retryable: boolean;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    status: number,
    retryable: boolean,
    details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MayarinApiError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.details = details;
  }
}

export function isMayarinApiError(error: unknown): error is MayarinApiError {
  return error instanceof MayarinApiError;
}

/** Maps a non-2xx response onto the one error type. */
export function errorFromResponse(status: number, body: unknown): MayarinApiError {
  if (isErrorBody(body)) {
    return new MayarinApiError(
      body.error.code,
      body.error.message,
      status,
      body.error.retryable,
      body.error.details ?? {},
    );
  }
  return new MayarinApiError(INVALID_RESPONSE, `The API returned HTTP ${status}`, status, false);
}

function isErrorBody(body: unknown): body is ErrorBody {
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const error = (body as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string" &&
    typeof (error as { retryable?: unknown }).retryable === "boolean"
  );
}
