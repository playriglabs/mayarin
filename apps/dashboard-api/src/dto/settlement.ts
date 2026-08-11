/**
 * Settlement DTOs (#15).
 *
 * What a merchant is owed and what they were paid, per payment. Three amounts
 * that are easy to conflate and must not be: `settlementAmount` is the payment
 * priced in the settlement asset, `fee` is what Mayarin takes, `netAmount` is
 * what the merchant receives. All three are locked at `PRICE_LOCKED`.
 *
 * `onChain` is separate from all of them: it is what the chain reported the
 * settlement actually moved. It is reported next to the locked figures rather
 * than in place of them — a payment where the two differ is the signal that a
 * route behaved unexpectedly, and overwriting the quote would erase exactly the
 * comparison that makes it visible.
 */

import type { SettlementRow, SettlementSummary } from "../services/settlement-read-service.ts";
import { optionalMoney, toMoneyDto } from "./money.ts";

export function toSettlementDto(row: SettlementRow) {
  const { intent, transaction, event } = row;

  return {
    paymentIntentId: intent.id,
    clearingTransactionId: transaction.id,
    state: transaction.state,
    /** What the buyer was charged, in the merchant's own currency. */
    sourceAmount: toMoneyDto(transaction.sourceAmount),
    settlementAsset: transaction.settlementAsset,
    settlementAmount: optionalMoney(transaction.settlementAmount) ?? null,
    fee: optionalMoney(transaction.fee) ?? null,
    netAmount: optionalMoney(transaction.netAmount) ?? null,
    /** Where the money was sent: the order's `merchantSafe` on the contract path. */
    destination: transaction.contract?.order.merchantSafe ?? null,
    /**
     * The settlement reference. On the contract path this is the transaction
     * hash; off-chain it is whatever the adapter returned.
     */
    reference: transaction.providerReference ?? transaction.contract?.txHash ?? null,
    provider: transaction.provider,
    executionPath: transaction.executionPath ?? null,
    onChain:
      transaction.onChain === undefined
        ? null
        : {
            settledAmount: toMoneyDto(transaction.onChain.settledAmount),
            fee: toMoneyDto(transaction.onChain.fee),
            refundAmount: toMoneyDto(transaction.onChain.refundAmount),
          },
    /**
     * The chain's own record of the settlement log, when there is one. Carries
     * the confirmation depth story the clearing row cannot: a settlement that
     * was acted on and then reorged away is visible here and nowhere else.
     */
    chain:
      event === undefined
        ? null
        : {
            chain: event.chain,
            txHash: event.txHash,
            blockNumber: event.blockNumber.toString(),
            status: event.status,
            firstSeenAt: event.firstSeenAt.toISOString(),
            confirmedAt: event.confirmedAt?.toISOString() ?? null,
            orphanedAt: event.orphanedAt?.toISOString() ?? null,
          },
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
    /**
     * The intent's expiry, carried so a reader can tell a payment that is still
     * moving from one nobody is going to pay. A payer who walks away leaves the
     * clearing row parked at `PAYMENT_PENDING` — the intent expires, the
     * clearing state does not follow it, and only this field separates the two.
     */
    expiresAt: intent.expiresAt.toISOString(),
    completedAt: intent.completedAt?.toISOString() ?? null,
  };
}

export function toSettlementSummaryDto(summary: SettlementSummary) {
  return {
    settledCount: summary.settledCount,
    inFlightCount: summary.inFlightCount,
    failedCount: summary.failedCount,
    asset: summary.asset ?? null,
    netAmount: optionalMoney(summary.netAmount) ?? null,
    fee: optionalMoney(summary.fee) ?? null,
  };
}
