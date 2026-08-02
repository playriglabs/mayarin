/**
 * Error taxonomy.
 *
 * Domain packages throw these; transport layers map them. `code` is the stable
 * contract for API clients — the message is for humans and may change.
 */

export type ErrorDetails = Record<string, unknown>;

export abstract class MayarrError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  /** Whether retrying the same request unchanged could succeed later. */
  readonly retryable: boolean = false;
  readonly details: ErrorDetails;

  constructor(message: string, details: ErrorDetails = {}, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.details = details;
  }

  toJSON(): { code: string; message: string; details: ErrorDetails } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function isMayarrError(error: unknown): error is MayarrError {
  return error instanceof MayarrError;
}

/** Input failed schema or domain validation. */
export class ValidationError extends MayarrError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;
}

/** A referenced aggregate does not exist. */
export class NotFoundError extends MayarrError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;
}

/** The request conflicts with current state (generic). */
export class ConflictError extends MayarrError {
  readonly code = "CONFLICT";
  readonly httpStatus = 409;
}

/**
 * An idempotency key was replayed with a different request body. Replaying the
 * *same* body is not an error — it returns the original result.
 */
export class IdempotencyConflictError extends MayarrError {
  readonly code = "IDEMPOTENCY_CONFLICT";
  readonly httpStatus = 409;
}

/** A state machine refused a transition. */
export class InvalidStateTransitionError extends MayarrError {
  readonly code = "INVALID_STATE_TRANSITION";
  readonly httpStatus = 409;
}

/** Two writers raced on the same aggregate; the loser should re-read and retry. */
export class ConcurrencyError extends MayarrError {
  readonly code = "CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;
  override readonly retryable = true;
}

/**
 * A ledger transaction did not balance. This is an invariant violation, never a
 * client error: it means Mayarr tried to record money that appeared or vanished.
 */
export class LedgerImbalanceError extends MayarrError {
  readonly code = "LEDGER_IMBALANCE";
  readonly httpStatus = 500;
}

/** A settlement provider rejected or failed a call. */
export class ProviderError extends MayarrError {
  readonly code = "PROVIDER_ERROR";
  readonly httpStatus = 502;
  override readonly retryable: boolean;

  constructor(
    message: string,
    details: ErrorDetails = {},
    options?: ErrorOptions & { retryable?: boolean },
  ) {
    super(message, details, options);
    this.retryable = options?.retryable ?? true;
  }
}

/** The deployment is misconfigured — missing adapter, unknown asset, bad env. */
export class ConfigurationError extends MayarrError {
  readonly code = "CONFIGURATION_ERROR";
  readonly httpStatus = 500;
}
