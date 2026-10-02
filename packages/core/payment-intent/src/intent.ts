/**
 * Payment intent creation and lifecycle transitions.
 *
 * Pure functions over immutable values: every transition returns a new intent
 * with a bumped `version`, and every illegal transition throws rather than
 * silently no-opping.
 */

import {
  type AssetCode,
  generateId,
  InvalidStateTransitionError,
  isPositive,
  type Money,
  ValidationError,
} from "@mayarin/shared";
import type {
  EscrowRequest,
  ExecutionPath,
  MerchantSnapshot,
  PaymentIntent,
  PaymentIntentStatus,
  PaymentRail,
  PaymentSource,
} from "./types.ts";

/** Legal successors for each status. Terminal statuses have none. */
const TRANSITIONS: Readonly<Record<PaymentIntentStatus, readonly PaymentIntentStatus[]>> = {
  CREATED: ["CONFIRMED", "EXPIRED", "FAILED"],
  CONFIRMED: ["PROCESSING", "EXPIRED", "FAILED"],
  PROCESSING: ["COMPLETED", "FAILED"],
  COMPLETED: [],
  FAILED: [],
  EXPIRED: [],
};

export const TERMINAL_STATUSES: readonly PaymentIntentStatus[] = ["COMPLETED", "FAILED", "EXPIRED"];

export interface CreatePaymentIntentInput {
  readonly merchant: MerchantSnapshot;
  readonly amount: Money;
  readonly settlementAsset: AssetCode;
  readonly provider: string;
  readonly payment?: PaymentRail;
  /** How the `payment` rail is executed. Absent for a fiat-only intent. */
  readonly executionPath?: ExecutionPath;
  readonly escrow?: EscrowRequest;
  readonly source: PaymentSource;
  readonly metadata?: Readonly<Record<string, string>>;
  readonly merchantReference?: string;
  readonly idempotencyKey?: string;
  readonly requestFingerprint?: string;
  readonly ttlSeconds: number;
  readonly now: Date;
}

export function createPaymentIntent(input: CreatePaymentIntentInput): PaymentIntent {
  if (!isPositive(input.amount)) {
    throw new ValidationError("Payment intent amount must be greater than zero", {
      amount: input.amount.amount.toString(),
      asset: input.amount.asset,
    });
  }

  if (input.ttlSeconds <= 0) {
    throw new ValidationError("Payment intent TTL must be greater than zero", {
      ttlSeconds: input.ttlSeconds,
    });
  }

  if (input.escrow !== undefined) {
    assertEscrow(input.escrow);
    if (input.payment !== undefined && input.executionPath !== undefined) {
      assertEscrowRail(input.payment, input.executionPath);
    }
  }

  const createdAt = new Date(input.now);

  return {
    id: generateId("pi", createdAt.getTime()),
    status: "CREATED",
    merchant: input.merchant,
    amount: input.amount,
    settlementAsset: input.settlementAsset,
    provider: input.provider,
    ...(input.payment === undefined ? {} : { payment: input.payment }),
    ...(input.executionPath === undefined ? {} : { executionPath: input.executionPath }),
    ...(input.escrow === undefined ? {} : { escrow: input.escrow }),
    source: input.source,
    metadata: input.metadata ?? {},
    ...(input.merchantReference === undefined
      ? {}
      : { merchantReference: input.merchantReference }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    ...(input.requestFingerprint === undefined
      ? {}
      : { requestFingerprint: input.requestFingerprint }),
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(createdAt.getTime() + input.ttlSeconds * 1_000),
    version: 1,
  };
}

/**
 * The shortest hold: a day, so "buyer protection" always leaves the buyer time
 * to look at what they bought before it releases on its own.
 */
export const MIN_ESCROW_HOLD_SECONDS = 24 * 60 * 60;
/** The longest hold an escrow may carry: a quarter, the usual chargeback window. */
export const MAX_ESCROW_HOLD_SECONDS = 90 * 24 * 60 * 60;

/**
 * The largest dispute bond (#315): a fifth of the payment. Enough to make a
 * bad-faith dispute cost something, not so much that a genuine one is priced
 * out.
 */
export const MAX_ESCROW_BOND_BPS = 2_000;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function assertEscrow(escrow: EscrowRequest): void {
  if (
    !Number.isInteger(escrow.holdSeconds) ||
    escrow.holdSeconds < MIN_ESCROW_HOLD_SECONDS ||
    escrow.holdSeconds > MAX_ESCROW_HOLD_SECONDS
  ) {
    throw new ValidationError(
      `Escrow hold must be a whole number of seconds between ${MIN_ESCROW_HOLD_SECONDS} (1 day) and ${MAX_ESCROW_HOLD_SECONDS} (90 days)`,
      { holdSeconds: escrow.holdSeconds },
    );
  }
  if (escrow.arbiter !== undefined && !ADDRESS_PATTERN.test(escrow.arbiter)) {
    throw new ValidationError("Escrow arbiter must be an EVM address", {
      arbiter: escrow.arbiter,
    });
  }
  if (
    escrow.bondBps !== undefined &&
    (!Number.isInteger(escrow.bondBps) ||
      escrow.bondBps < 0 ||
      escrow.bondBps > MAX_ESCROW_BOND_BPS)
  ) {
    throw new ValidationError(
      `The dispute bond must be a whole number of basis points from 0 to ${MAX_ESCROW_BOND_BPS} (20%)`,
      { bondBps: escrow.bondBps },
    );
  }
}

/** Escrow terms name the payer, so the rail must know the payer before the price lock. */
function assertEscrowRail(payment: PaymentRail, executionPath: ExecutionPath): void {
  if (executionPath === "x402") {
    throw new ValidationError("Escrow is not available on the x402 path", { executionPath });
  }
  if (payment.payerAddress === undefined || !ADDRESS_PATTERN.test(payment.payerAddress)) {
    throw new ValidationError("An escrowed payment needs the payer's wallet address", {
      executionPath,
    });
  }
}

export function isTerminal(intent: PaymentIntent): boolean {
  return TERMINAL_STATUSES.includes(intent.status);
}

/**
 * Whether the deadline has passed on an intent that may still expire.
 *
 * Expiry means "nobody paid in time", and that stops being true the moment the
 * payment is `PROCESSING`: the payer's asset is in flight and the clearing
 * engine owns the outcome. The state machine already says so — `PROCESSING`
 * lists no `EXPIRED` successor — and this now asks it rather than restating the
 * rule as "not terminal".
 *
 * The old reading called a late-funding payment expired, and since the
 * transition it then attempted was illegal, every read of that intent threw:
 * `getById` expires on the way out, so a payment funded past its deadline could
 * never be completed, or even loaded, again. A payer who paid slowly had their
 * payment wedged rather than settled.
 */
export function isExpired(intent: PaymentIntent, now: Date): boolean {
  return canTransition(intent.status, "EXPIRED") && now.getTime() >= intent.expiresAt.getTime();
}

export function canTransition(from: PaymentIntentStatus, to: PaymentIntentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Moves an intent to `CONFIRMED`, the point the payer commits to paying. */
export function confirm(intent: PaymentIntent, now: Date): PaymentIntent {
  if (isExpired(intent, now)) {
    throw new InvalidStateTransitionError(`Payment intent ${intent.id} has expired`, {
      id: intent.id,
      expiresAt: intent.expiresAt.toISOString(),
    });
  }
  return transition(intent, "CONFIRMED", now, { confirmedAt: new Date(now) });
}

/**
 * Records the rail the payer chose, on an intent minted without one.
 *
 * A storefront's cart checkout rings up a sale before the buyer has said how
 * they will pay; the hosted payment page asks, and this is the answer. Only
 * while the intent is still `CREATED`: once confirmed, the price lock and the
 * deposit address belong to the rail it was confirmed on. A rail already chosen
 * is not swappable either — asking again with the same rail is a replay and
 * returns the intent unchanged, asking with a different one is refused.
 */
export function choosePayment(
  intent: PaymentIntent,
  payment: PaymentRail,
  executionPath: ExecutionPath,
  settlementAsset: AssetCode,
  now: Date,
  /** The merchant's buyer protection, taken up only by an intent minted without escrow. */
  protection?: EscrowRequest,
): PaymentIntent {
  if (intent.payment !== undefined) {
    if (intent.payment.asset === payment.asset && intent.payment.chain === payment.chain) {
      return intent;
    }
    throw new ValidationError(`Payment intent ${intent.id} is already paid on another rail`, {
      id: intent.id,
      asset: intent.payment.asset,
      chain: intent.payment.chain,
    });
  }
  const escrow = intent.escrow ?? protection;
  if (escrow !== undefined) assertEscrowRail(payment, executionPath);
  if (intent.status !== "CREATED" || isExpired(intent, now)) {
    throw new InvalidStateTransitionError(
      `Payment intent ${intent.id} can no longer take a payment rail`,
      { id: intent.id, status: intent.status, expiresAt: intent.expiresAt.toISOString() },
    );
  }

  return {
    ...intent,
    payment,
    executionPath,
    ...(escrow === undefined ? {} : { escrow }),
    settlementAsset,
    updatedAt: new Date(now),
    version: intent.version + 1,
  };
}

/** Moves an intent to `PROCESSING` and binds it to its clearing transaction. */
export function markProcessing(
  intent: PaymentIntent,
  clearingTransactionId: string,
  now: Date,
): PaymentIntent {
  return transition(intent, "PROCESSING", now, { clearingTransactionId });
}

export function markCompleted(intent: PaymentIntent, now: Date): PaymentIntent {
  return transition(intent, "COMPLETED", now, { completedAt: new Date(now) });
}

export function markFailed(intent: PaymentIntent, reason: string, now: Date): PaymentIntent {
  return transition(intent, "FAILED", now, { failureReason: reason });
}

/**
 * Reopens an intent whose clearing failed after the payer's funds arrived, so
 * a retried settlement can complete it (#296 follow-up).
 *
 * Deliberately outside the transition table: `FAILED` stays terminal for every
 * ordinary path, and this one exists only for the engine's `retry`, which has
 * already checked that the money is there to settle.
 */
export function reopenIntent(intent: PaymentIntent, now: Date): PaymentIntent {
  if (intent.status !== "FAILED") {
    throw new InvalidStateTransitionError(`Payment intent ${intent.id} has not failed`, {
      id: intent.id,
      status: intent.status,
    });
  }
  const { failureReason: _failureReason, ...rest } = intent;
  return {
    ...rest,
    status: "PROCESSING",
    updatedAt: new Date(now),
    version: intent.version + 1,
  };
}

export function markExpired(intent: PaymentIntent, now: Date): PaymentIntent {
  return transition(intent, "EXPIRED", now, {});
}

function transition(
  intent: PaymentIntent,
  next: PaymentIntentStatus,
  now: Date,
  patch: Partial<PaymentIntent>,
): PaymentIntent {
  if (!canTransition(intent.status, next)) {
    throw new InvalidStateTransitionError(
      `Payment intent ${intent.id} cannot move from ${intent.status} to ${next}`,
      { id: intent.id, from: intent.status, to: next },
    );
  }

  return {
    ...intent,
    ...patch,
    status: next,
    updatedAt: new Date(now),
    version: intent.version + 1,
  };
}
