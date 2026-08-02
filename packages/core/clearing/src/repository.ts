import type { ClearingEvent, ClearingTransaction } from "./types.ts";

/**
 * Persistence port for clearing.
 *
 * `insert` and `update` take the events produced by the transition and must
 * persist them in the same database transaction as the state change: a state
 * without its event is an audit hole, and an event without its state is a lie.
 */
export interface ClearingRepository {
  insert(transaction: ClearingTransaction, events: readonly ClearingEvent[]): Promise<void>;
  update(
    transaction: ClearingTransaction,
    expectedVersion: number,
    events: readonly ClearingEvent[],
  ): Promise<void>;
  findById(id: string): Promise<ClearingTransaction | null>;
  findByPaymentIntentId(paymentIntentId: string): Promise<ClearingTransaction | null>;
  findByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<ClearingTransaction | null>;
  listEvents(clearingTransactionId: string): Promise<ClearingEvent[]>;
  /** Transactions stuck in a non-terminal state, oldest first. Drives recovery sweeps. */
  listResumable(limit: number): Promise<ClearingTransaction[]>;
}
