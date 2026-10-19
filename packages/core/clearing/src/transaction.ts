/**
 * Clearing transaction construction and transitions.
 *
 * Pure functions: a transition produces the next transaction value plus the
 * event that records it, and the caller persists both atomically.
 */

import type { PaymentIntent } from "@mayarin/payment-intent";
import {
  generateId,
  InvalidStateTransitionError,
  type Money,
  serializeMoney,
} from "@mayarin/shared";
import type { ContractOrder } from "./contract-path.ts";
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

/**
 * Records a broadcast settlement transaction without moving the state.
 *
 * Every other write here is a state change; this one deliberately is not. The
 * transaction stays where it is because nothing has been confirmed — but the
 * hash is durable from this moment, so a confirmation that fails afterwards
 * leaves something to resume from rather than money nobody can find.
 */
export function recordSettlementBroadcast(
  transaction: ClearingTransaction,
  providerReference: string,
  authorized: Money,
  now: Date,
): TransitionResult {
  const updatedAt = new Date(now);
  const next: ClearingTransaction = {
    ...transaction,
    providerReference,
    updatedAt,
    version: transaction.version + 1,
  };

  return {
    transaction: next,
    event: {
      id: generateId("evt", updatedAt.getTime()),
      clearingTransactionId: transaction.id,
      sequence: next.version,
      type: "settlement.broadcast",
      toState: transaction.state,
      // What the payer signed, in the asset they signed in. On a same-asset
      // rail that is the lock again; on a cross-asset one it is the swap's
      // budget and appears nowhere else, and a resume between the two chain
      // movements has nothing else to read it from — the quote it came from has
      // moved and the authorization it describes is already spent.
      payload: { providerReference, authorized: serializeMoney(authorized) },
      occurredAt: updatedAt,
    },
  };
}

/**
 * Records the swap that pays the merchant on a cross-asset payment (#211).
 *
 * Persist-before-confirm, one movement later than `recordSettlementBroadcast`,
 * and for a sharper reason. The authorization cannot be re-sent — EIP-3009 has
 * recorded its nonce — so a lost broadcast hash strands money. A swap has no
 * such guard: re-sending one spends the operator's own balance and pays the
 * merchant a second time. Writing the hash first is what lets a resume confirm
 * the swap instead of repeating it.
 *
 * The reference moves off the authorization and onto the swap, because the
 * settlement reference names the transaction that paid the merchant and on a
 * cross-asset payment that is not the one the payer signed. The authorization's
 * own hash stays in the `settlement.broadcast` event before it.
 */
export function recordCrossAssetSwap(
  transaction: ClearingTransaction,
  providerReference: string,
  now: Date,
): TransitionResult {
  const updatedAt = new Date(now);
  const next: ClearingTransaction = {
    ...transaction,
    providerReference,
    updatedAt,
    version: transaction.version + 1,
  };

  return {
    transaction: next,
    event: {
      id: generateId("evt", updatedAt.getTime()),
      clearingTransactionId: transaction.id,
      sequence: next.version,
      type: "settlement.swap",
      toState: transaction.state,
      payload: { providerReference },
      occurredAt: updatedAt,
    },
  };
}

function recordPayerSurplusRefundEvent(
  transaction: ClearingTransaction,
  type: "payer-surplus.refund.broadcast" | "payer-surplus.refund.confirmed",
  providerReference: string,
  amount: Money,
  payer: string,
  now: Date,
): TransitionResult {
  const updatedAt = new Date(now);
  const next: ClearingTransaction = {
    ...transaction,
    updatedAt,
    version: transaction.version + 1,
  };
  return {
    transaction: next,
    event: {
      id: generateId("evt", updatedAt.getTime()),
      clearingTransactionId: transaction.id,
      sequence: next.version,
      type,
      toState: transaction.state,
      payload: { providerReference, amount: serializeMoney(amount), payer },
      occurredAt: updatedAt,
    },
  };
}

export function recordPayerSurplusRefundBroadcast(
  transaction: ClearingTransaction,
  providerReference: string,
  amount: Money,
  payer: string,
  now: Date,
): TransitionResult {
  return recordPayerSurplusRefundEvent(
    transaction,
    "payer-surplus.refund.broadcast",
    providerReference,
    amount,
    payer,
    now,
  );
}

export function recordPayerSurplusRefundConfirmed(
  transaction: ClearingTransaction,
  providerReference: string,
  amount: Money,
  payer: string,
  now: Date,
): TransitionResult {
  return recordPayerSurplusRefundEvent(
    transaction,
    "payer-surplus.refund.confirmed",
    providerReference,
    amount,
    payer,
    now,
  );
}

/**
 * Swaps in a re-signed order — same terms, fresh deadline — for one whose
 * deadline passed before the executor could submit it. Persisted before the
 * submission, so a crash in between resumes with the fresh order and does not
 * renew again.
 */
export function recordOrderRenewed(
  transaction: ClearingTransaction,
  order: ContractOrder,
  expiresAt: Date,
  now: Date,
): TransitionResult {
  const contract = transaction.contract;
  if (contract === undefined) {
    throw new InvalidStateTransitionError(`Transaction ${transaction.id} has no order to renew`, {
      id: transaction.id,
    });
  }
  const updatedAt = new Date(now);
  const next: ClearingTransaction = {
    ...transaction,
    contract: { ...contract, order, expiresAt },
    updatedAt,
    version: transaction.version + 1,
  };
  return {
    transaction: next,
    event: {
      id: generateId("evt", updatedAt.getTime()),
      clearingTransactionId: transaction.id,
      sequence: next.version,
      type: "order.renewed",
      toState: transaction.state,
      payload: {
        orderIntentId: order.intentId,
        orderDeadline: order.deadline.toString(),
        previousDeadline: contract.order.deadline.toString(),
      },
      occurredAt: updatedAt,
    },
  };
}

/**
 * Reopens a failed transaction whose funds had arrived: `FAILED` back to
 * `ASSET_RECEIVED`, from where the ordinary steps settle it.
 *
 * Deliberately outside the transition table — `FAILED` stays terminal for every
 * other path — and refused unless `fundsArrived`, which the engine reads from
 * the event log. Reopening a payment that never received anything would settle
 * money that is not there. Every later step is keyed per state, so the replay
 * repeats only what did not happen the first time.
 */
export function reopenTransaction(
  transaction: ClearingTransaction,
  fundsArrived: boolean,
  now: Date,
): TransitionResult {
  if (transaction.state !== "FAILED" || transaction.failure === undefined) {
    throw new InvalidStateTransitionError(`Transaction ${transaction.id} has not failed`, {
      id: transaction.id,
      state: transaction.state,
    });
  }
  if (!fundsArrived) {
    throw new InvalidStateTransitionError(
      "Only a payment whose funds arrived can be retried; start a new payment instead",
      { id: transaction.id },
    );
  }

  const updatedAt = new Date(now);
  const { failure, ...rest } = transaction;
  const next: ClearingTransaction = {
    ...rest,
    state: "ASSET_RECEIVED",
    updatedAt,
    version: transaction.version + 1,
  };
  return {
    transaction: next,
    event: {
      id: generateId("evt", updatedAt.getTime()),
      clearingTransactionId: transaction.id,
      sequence: next.version,
      type: "state.reopened",
      fromState: "FAILED",
      toState: "ASSET_RECEIVED",
      payload: { previousReason: failure.reason, previousCode: failure.code },
      occurredAt: updatedAt,
    },
  };
}

/** The failure code `sweepExpired` records for a payer who never paid in time. */
export const PAYMENT_EXPIRED = "PAYMENT_EXPIRED";

/**
 * Reopens a payment that expired before its funds were seen, because they
 * arrived after all.
 *
 * Not `reopenTransaction`: that is for a payment whose funds were already
 * received and whose clearing failed since. Here the funds were never recorded,
 * so the history has no `ASSET_RECEIVED` and this is what writes it. Only an
 * expired payment qualifies: any other failure took a decision, and a late
 * deposit does not undo it. Whether the deposit covers the amount is the chain
 * layer's to check, and the price this settles at is the one that was locked.
 */
export function reopenForLateFunds(transaction: ClearingTransaction, now: Date): TransitionResult {
  if (transaction.state !== "FAILED" || transaction.failure?.code !== PAYMENT_EXPIRED) {
    throw new InvalidStateTransitionError(
      `Transaction ${transaction.id} did not fail by expiring, so late funds do not reopen it`,
      { id: transaction.id, state: transaction.state, code: transaction.failure?.code },
    );
  }

  const updatedAt = new Date(now);
  const { failure, ...rest } = transaction;
  const next: ClearingTransaction = {
    ...rest,
    state: "ASSET_RECEIVED",
    updatedAt,
    version: transaction.version + 1,
  };
  return {
    transaction: next,
    event: {
      id: generateId("evt", updatedAt.getTime()),
      clearingTransactionId: transaction.id,
      sequence: next.version,
      type: "state.reopened",
      fromState: "FAILED",
      toState: "ASSET_RECEIVED",
      payload: {
        previousReason: failure.reason,
        previousCode: failure.code,
        lateFunds: true,
      },
      occurredAt: updatedAt,
    },
  };
}

export function failTransaction(
  transaction: ClearingTransaction,
  failure: ClearingFailure,
  details: Readonly<Record<string, unknown>> = {},
): TransitionResult {
  return transition(
    transaction,
    "FAILED",
    failure.at,
    { failure },
    { ...details, reason: failure.reason, code: failure.code },
  );
}
