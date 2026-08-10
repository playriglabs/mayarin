/**
 * Clearing transaction and timeline DTOs.
 */

import type { ClearingEvent, ClearingTransaction } from "@mayarin/clearing";
import { optionalMoney, toMoneyDto } from "./money.ts";

export function toClearingDto(transaction: ClearingTransaction) {
  return {
    id: transaction.id,
    state: transaction.state,
    provider: transaction.provider,
    providerReference: transaction.providerReference ?? null,
    transactionHash: transaction.contract?.txHash ?? null,
    sourceAmount: toMoneyDto(transaction.sourceAmount),
    settlementAmount: optionalMoney(transaction.settlementAmount) ?? null,
    fee: optionalMoney(transaction.fee) ?? null,
    netAmount: optionalMoney(transaction.netAmount) ?? null,
    rate:
      transaction.rate === undefined
        ? null
        : {
            from: transaction.rate.from,
            to: transaction.rate.to,
            scaledRate: transaction.rate.scaledRate.toString(),
            source: transaction.rate.source,
            lockedAt: transaction.rate.lockedAt.toISOString(),
          },
    failure:
      transaction.failure === undefined
        ? null
        : {
            reason: transaction.failure.reason,
            code: transaction.failure.code,
            at: transaction.failure.at.toISOString(),
          },
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}

/** Compact, ordered audit trail — the "how it got here" of a payment. */
export function toTimelineDto(events: readonly ClearingEvent[]) {
  return events.map((event) => ({
    sequence: event.sequence,
    state: event.toState,
    from: event.fromState ?? null,
    occurredAt: event.occurredAt.toISOString(),
  }));
}
