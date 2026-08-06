/**
 * Error taxonomy.
 *
 * Domain packages throw these; transport layers map them. `code` is the stable
 * contract for API clients — the message is for humans and may change.
 */

export type ErrorDetails = Record<string, unknown>;

export abstract class MayarinError extends Error {
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

export function isMayarinError(error: unknown): error is MayarinError {
  return error instanceof MayarinError;
}

/** Input failed schema or domain validation. */
export class ValidationError extends MayarinError {
  readonly code = "VALIDATION_ERROR";
  readonly httpStatus = 400;
}

/** A referenced aggregate does not exist. */
export class NotFoundError extends MayarinError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;
}

/** The request conflicts with current state (generic). */
export class ConflictError extends MayarinError {
  readonly code = "CONFLICT";
  readonly httpStatus = 409;
}

/**
 * An idempotency key was replayed with a different request body. Replaying the
 * *same* body is not an error — it returns the original result.
 */
export class IdempotencyConflictError extends MayarinError {
  readonly code = "IDEMPOTENCY_CONFLICT";
  readonly httpStatus = 409;
}

/** A state machine refused a transition. */
export class InvalidStateTransitionError extends MayarinError {
  readonly code = "INVALID_STATE_TRANSITION";
  readonly httpStatus = 409;
}

/** Two writers raced on the same aggregate; the loser should re-read and retry. */
export class ConcurrencyError extends MayarinError {
  readonly code = "CONCURRENCY_CONFLICT";
  readonly httpStatus = 409;
  override readonly retryable = true;
}

/**
 * A ledger transaction did not balance. This is an invariant violation, never a
 * client error: it means Mayarin tried to record money that appeared or vanished.
 */
export class LedgerImbalanceError extends MayarinError {
  readonly code = "LEDGER_IMBALANCE";
  readonly httpStatus = 500;
}

/** A settlement provider rejected or failed a call. */
export class ProviderError extends MayarinError {
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
export class ConfigurationError extends MayarinError {
  readonly code = "CONFIGURATION_ERROR";
  readonly httpStatus = 500;
}

/** Authentication is missing or invalid — no session, expired/revoked session, bad credentials. */
export class UnauthorizedError extends MayarinError {
  readonly code = "UNAUTHORIZED";
  readonly httpStatus = 401;
}

/** The caller is authenticated but lacks the role or scope for this resource. */
export class ForbiddenError extends MayarinError {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;
}

/**
 * A locked quote passed its deadline before the payment completed. Not
 * retryable: a new price needs the payer's consent, so the flow starts over
 * with a fresh quote instead of the engine silently re-pricing.
 */
export class QuoteExpiredError extends MayarinError {
  readonly code = "QUOTE_EXPIRED";
  readonly httpStatus = 410;
}
