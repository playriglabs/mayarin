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
