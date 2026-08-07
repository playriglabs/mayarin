/**
 * Chain domain events.
 *
 * A deposit that was confirmed and then reorged away is published here rather
 * than appended to `clearing_events`: that table's `sequence` equals the
 * clearing transaction's `version`, and both count applied transitions, so an
 * entry with no transition behind it would break the invariant.
 */

import { type DomainEvent, generateId } from "@mayarin/shared";
import type { Deposit, SettlementEvent } from "./types.ts";

export const CHAIN_DEPOSIT_ORPHANED = "chain.deposit.orphaned";
export const CHAIN_SETTLEMENT_ORPHANED = "chain.settlement.orphaned";
export const CHAIN_SETTLEMENT_UNMATCHED = "chain.settlement.unmatched";

export function depositOrphanedEvent(
  deposit: Deposit,
  clearingTransactionId: string,
  now: Date,
): DomainEvent {
  return {
    id: generateId("dep", now.getTime()),
    type: CHAIN_DEPOSIT_ORPHANED,
    aggregateId: clearingTransactionId,
    occurredAt: new Date(now),
    payload: {
      depositId: deposit.id,
      chain: deposit.chain,
      txHash: deposit.txHash,
      logIndex: deposit.logIndex,
      address: deposit.address,
      amount: deposit.amount.amount.toString(),
      asset: deposit.amount.asset,
      blockNumber: deposit.blockNumber.toString(),
      /** True when value that had already been counted was lost. */
      wasConfirmed: deposit.confirmedAt !== undefined,
    },
  };
}

/**
 * A `PaymentCompleted` log that was reorged away.
 *
 * Never auto-reversed. If it had already completed a payment the merchant has
 * been paid on-chain and told so, and `SETTLED -> unsettled` is not a legal
 * transition in a state machine whose whole value is being forward-only.
 * `wasCompleted` is what separates a harmless loss from the case needing a
 * human.
 */
export function settlementOrphanedEvent(event: SettlementEvent, now: Date): DomainEvent {
  return {
    id: generateId("stl", now.getTime()),
    type: CHAIN_SETTLEMENT_ORPHANED,
    aggregateId: event.intentId,
    occurredAt: new Date(now),
    payload: {
      settlementId: event.id,
      chain: event.chain,
      txHash: event.txHash,
      logIndex: event.logIndex,
      intentId: event.intentId,
      merchantSafe: event.merchantSafe,
      settledAmount: event.settledAmount.toString(),
      blockNumber: event.blockNumber.toString(),
      /** True when a payment had already been settled on the strength of it. */
      wasCompleted: event.completedAt !== undefined,
    },
  };
}

/**
 * A confirmed settlement naming an `intentId` no payment claims.
 *
 * The router only emits `PaymentCompleted` for an order this backend signed, so
 * this means the chain and the database disagree — money moved for a payment
 * that is not recorded. Surfaced rather than absorbed, which is the whole point
 * of the ledger being a derived view.
 */
export function settlementUnmatchedEvent(event: SettlementEvent, now: Date): DomainEvent {
  return {
    id: generateId("stl", now.getTime()),
    type: CHAIN_SETTLEMENT_UNMATCHED,
    aggregateId: event.intentId,
    occurredAt: new Date(now),
    payload: {
      settlementId: event.id,
      chain: event.chain,
      txHash: event.txHash,
      logIndex: event.logIndex,
      intentId: event.intentId,
      merchantSafe: event.merchantSafe,
      settledAmount: event.settledAmount.toString(),
      fee: event.fee.toString(),
      refundAmount: event.refundAmount.toString(),
      blockNumber: event.blockNumber.toString(),
    },
  };
}
