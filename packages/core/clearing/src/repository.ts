import type { AssetCode } from "@mayarin/shared";
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
  /**
   * The transactions behind a page of payment intents, in one round trip.
   *
   * A settlement listing is a page of intents plus what clearing made of each,
   * and resolving that one intent at a time is a query per row. Ids the caller
   * holds that have no transaction are simply absent from the result.
   */
  listByPaymentIntentIds(
    paymentIntentIds: readonly string[],
  ): Promise<readonly ClearingTransaction[]>;
  /**
   * The transaction whose signed order carries this on-chain `intentId`.
   *
   * How the indexer resolves a `PaymentCompleted` log to a payment: the log
   * names the id the backend signed, and nothing else on the chain identifies
   * the payment.
   */
  findByContractIntentId(intentId: string): Promise<ClearingTransaction | null>;
  findByProviderReference(
    provider: string,
    providerReference: string,
  ): Promise<ClearingTransaction | null>;
  listEvents(clearingTransactionId: string): Promise<ClearingEvent[]>;
  /**
   * What one merchant has been priced for in `asset` since `since`: the locked
   * settlement amounts of every transaction that is not `FAILED`. A payment
   * still waiting to be paid counts, so the figure is the exposure the merchant
   * could reach, not only what has settled.
   */
  settlementVolumeSince(merchantId: string, asset: AssetCode, since: Date): Promise<bigint>;
  /** Transactions stuck in a non-terminal state, oldest first. Drives recovery sweeps. */
  listResumable(limit: number): Promise<ClearingTransaction[]>;
  /** Transactions that failed with `code` at or after `since`, newest first. */
  listFailedByCode(code: string, since: Date, limit: number): Promise<ClearingTransaction[]>;
  /** Successful payments with refundable payer surplus not yet confirmed as returned. */
  listPendingPayerSurplusRefunds(limit: number): Promise<ClearingTransaction[]>;
  /**
   * Failed deposit-path payments whose payer asset arrived, was never sent to
   * the router, and has not been returned: failed at or before `failedBefore`,
   * with no `deposit.return.confirmed` event.
   */
  listPendingDepositReturns(failedBefore: Date, limit: number): Promise<ClearingTransaction[]>;
}
