/**
 * Chain domain events.
 *
 * A deposit that was confirmed and then reorged away is published here rather
 * than appended to `clearing_events`: that table's `sequence` equals the
 * clearing transaction's `version`, and both count applied transitions, so an
 * entry with no transition behind it would break the invariant.
 */

import { type DomainEvent, generateId } from "@mayarin/shared";
import type { Deposit } from "./types.ts";

export const CHAIN_DEPOSIT_ORPHANED = "chain.deposit.orphaned";

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
