/**
 * Refunds.
 *
 * A refund is **a new transfer, not a reversal**. The original settlement is
 * final — on-chain it is a mined transaction and nothing un-sends it — so a
 * refund gets its own identifier, its own postings and its own lifecycle rather
 * than editing the payment that caused it.
 *
 * Two consequences follow, and both are deliberate:
 *
 * - The payment's own state never changes. `SUCCESS` stays `SUCCESS`; how much
 *   of it came back is *derived* from the refunds recorded against it. A
 *   payment that flipped to `REFUNDED` would lose the fact that it succeeded,
 *   which is the fact the ledger and the audit trail are built on.
 * - Refunds accumulate. Several partials may exist against one payment, and
 *   what bounds them is their sum, not any one of them.
 */

import { generateId, type Money, ValidationError } from "@mayarin/shared";

/**
 * Lifecycle of one refund attempt.
 *
 * `PENDING` exists because a rail may take time to confirm. A refund that never
 * leaves `PENDING` still counts against the refundable balance — releasing it
 * back would let a stuck refund be issued twice.
 */
export const REFUND_STATES = ["PENDING", "SUCCEEDED", "FAILED"] as const;

export type RefundState = (typeof REFUND_STATES)[number];

export interface Refund {
  readonly id: string;
  readonly clearingTransactionId: string;
  readonly paymentIntentId: string;
  readonly merchantId: string;
  /** Denominated in the settlement asset — what the merchant was actually paid in. */
  readonly amount: Money;
  readonly state: RefundState;
  readonly reason?: string;
  /** The caller's key. Replaying it returns this refund rather than issuing another. */
  readonly idempotencyKey?: string;
  /** The rail's identifier for the refund, once it has one. */
  readonly providerReference?: string;
  readonly failureReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * How much of a payment has come back, and how much still could.
 *
 * `FAILED` refunds are excluded from both: a refund that did not happen has not
 * returned value and must not consume the balance.
 */
export interface RefundSummary {
  /** The most that may ever be refunded — the merchant's net, not the gross. */
  readonly refundable: Money;
  readonly refunded: Money;
  readonly remaining: Money;
  readonly state: "NONE" | "PARTIAL" | "FULL";
}

export interface CreateRefundInput {
  readonly clearingTransactionId: string;
  readonly paymentIntentId: string;
  readonly merchantId: string;
  readonly amount: Money;
  readonly reason?: string;
  readonly idempotencyKey?: string;
  readonly now: Date;
}

export function createRefund(input: CreateRefundInput): Refund {
  if (input.amount.amount <= 0n) {
    throw new ValidationError("A refund must be greater than zero", {
      amount: input.amount.amount.toString(),
    });
  }

  const createdAt = new Date(input.now);

  return {
    id: generateId("rfd", createdAt.getTime()),
    clearingTransactionId: input.clearingTransactionId,
    paymentIntentId: input.paymentIntentId,
    merchantId: input.merchantId,
    amount: input.amount,
    state: "PENDING",
    ...(input.reason === undefined ? {} : { reason: input.reason }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    createdAt,
    updatedAt: createdAt,
  };
}

export function markRefundSucceeded(refund: Refund, providerReference: string, now: Date): Refund {
  return { ...refund, state: "SUCCEEDED", providerReference, updatedAt: new Date(now) };
}

export function markRefundFailed(refund: Refund, reason: string, now: Date): Refund {
  return { ...refund, state: "FAILED", failureReason: reason, updatedAt: new Date(now) };
}

/**
 * What a payment's refunds add up to.
 *
 * `refundable` is the merchant's **net**, not the gross the payer sent. The fee
 * was earned on a payment that did happen, and returning it would mean Mayarin
 * pays to have provided a service — which is the same choice every processor
 * that stopped refunding fees made, for the same reason. A merchant who wants
 * to make the payer whole for the fee can refund from their own balance; what
 * this bounds is what the ledger can give back.
 */
export function summariseRefunds(netAmount: Money, refunds: readonly Refund[]): RefundSummary {
  const refunded = refunds
    .filter((refund) => refund.state !== "FAILED")
    .reduce((total, refund) => total + refund.amount.amount, 0n);

  const remaining = netAmount.amount - refunded;

  return {
    refundable: netAmount,
    refunded: { amount: refunded, asset: netAmount.asset },
    remaining: { amount: remaining, asset: netAmount.asset },
    state: refunded === 0n ? "NONE" : remaining <= 0n ? "FULL" : "PARTIAL",
  };
}

/**
 * Refuses a refund that would take more than the payment brought in.
 *
 * Checked against the **sum** of everything not-failed, not against the largest
 * single refund: two partials that are each within the balance can exceed it
 * together, and that is the case a naive check misses.
 */
export function assertRefundable(summary: RefundSummary, amount: Money): void {
  if (amount.asset !== summary.refundable.asset) {
    throw new ValidationError(
      `A refund must be denominated in ${summary.refundable.asset}, not ${amount.asset}`,
      { expected: summary.refundable.asset, received: amount.asset },
    );
  }

  if (amount.amount > summary.remaining.amount) {
    throw new ValidationError("A refund cannot exceed what remains refundable on this payment", {
      requested: amount.amount.toString(),
      remaining: summary.remaining.amount.toString(),
      alreadyRefunded: summary.refunded.amount.toString(),
    });
  }
}
