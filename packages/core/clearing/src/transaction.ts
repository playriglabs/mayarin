/**
 * Clearing transaction construction and transitions.
 *
 * Pure functions: a transition produces the next transaction value plus the
 * event that records it, and the caller persists both atomically.
 */

import type { PaymentIntent } from "@mayarin/payment-intent";
import { generateId, serializeMoney } from "@mayarin/shared";
import { assertTransition } from "./state-machine.ts";
import type {
  ClearingEvent,
  ClearingFailure,
  ClearingState,
  ClearingTransaction,
} from "./types.ts";

export function createClearingTransaction(
  intent: PaymentIntent,
  now: Date,
): { transaction: ClearingTransaction; event: ClearingEvent } {
  const createdAt = new Date(now);
  const transaction: ClearingTransaction = {
    id: generateId("clr", createdAt.getTime()),
    paymentIntentId: intent.id,
    state: "CREATED",
    merchant: {
      id: intent.merchant.id,
      name: intent.merchant.name,
      city: intent.merchant.city,
      countryCode: intent.merchant.countryCode,
    },
    sourceAmount: intent.amount,
    settlementAsset: intent.settlementAsset,
    provider: intent.provider,
    ...(intent.executionPath === undefined ? {} : { executionPath: intent.executionPath }),
    createdAt,
    updatedAt: createdAt,
    version: 1,
  };

  return {
    transaction,
    event: {
      id: generateId("evt", createdAt.getTime()),
      clearingTransactionId: transaction.id,
      sequence: 1,
      type: "transaction.created",
      toState: "CREATED",
      payload: {
        paymentIntentId: intent.id,
        amount: serializeMoney(intent.amount),
        settlementAsset: intent.settlementAsset,
        provider: intent.provider,
        ...(intent.executionPath === undefined ? {} : { executionPath: intent.executionPath }),
      },
      occurredAt: createdAt,
    },
  };
}

export interface TransitionResult {
  readonly transaction: ClearingTransaction;
  readonly event: ClearingEvent;
}

/** Applies a legal transition, returning the next value and its log entry. */
export function transition(
  transaction: ClearingTransaction,
  to: ClearingState,
  now: Date,
  patch: Partial<ClearingTransaction> = {},
  payload: Readonly<Record<string, unknown>> = {},
): TransitionResult {
  assertTransition(transaction, to);

  const updatedAt = new Date(now);
  const next: ClearingTransaction = {
    ...transaction,
    ...patch,
    state: to,
    updatedAt,
    version: transaction.version + 1,
  };

  return {
    transaction: next,
    event: {
      id: generateId("evt", updatedAt.getTime()),
      clearingTransactionId: transaction.id,
      // Version doubles as the event sequence: both count applied transitions.
      sequence: next.version,
      type: to === "FAILED" ? "state.failed" : "state.changed",
      fromState: transaction.state,
      toState: to,
      payload,
      occurredAt: updatedAt,
    },
  };
}

export function failTransaction(
  transaction: ClearingTransaction,
  failure: ClearingFailure,
): TransitionResult {
  return transition(
    transaction,
    "FAILED",
    failure.at,
    { failure },
    { reason: failure.reason, code: failure.code },
  );
}
