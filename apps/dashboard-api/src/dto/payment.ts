/**
 * Payment DTOs — the dashboard's read-only view of a payment.
 *
 * A subset of the payment API's wire shape: the dashboard never creates or
 * confirms intents, so only the read-bearing fields cross the wire. Mappers are
 * pure; the route assembles them.
 */

import type { ClearingEvent, ClearingTransaction } from "@mayarin/clearing";
import type { PaymentIntent } from "@mayarin/payment-intent";
import { optionalMoney, toMoneyDto } from "./money.ts";

export function toPaymentIntentDto(intent: PaymentIntent) {
  return {
    id: intent.id,
    status: intent.status,
    merchant: intent.merchant,
    amount: toMoneyDto(intent.amount),
    settlementAsset: intent.settlementAsset,
    provider: intent.provider,
    payment: intent.payment ?? null,
    source: intent.source,
    merchantReference: intent.merchantReference ?? null,
    metadata: intent.metadata ?? {},
    clearingTransactionId: intent.clearingTransactionId ?? null,
    failureReason: intent.failureReason ?? null,
    createdAt: intent.createdAt.toISOString(),
    expiresAt: intent.expiresAt.toISOString(),
    confirmedAt: intent.confirmedAt?.toISOString() ?? null,
    completedAt: intent.completedAt?.toISOString() ?? null,
  };
}

export function toClearingDto(transaction: ClearingTransaction) {
  return {
    id: transaction.id,
    state: transaction.state,
    provider: transaction.provider,
    providerReference: transaction.providerReference ?? null,
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

export function toPaymentDetailDto(
  intent: PaymentIntent,
  transaction: ClearingTransaction | null,
  events: readonly ClearingEvent[],
) {
  return {
    paymentIntent: toPaymentIntentDto(intent),
    clearing: transaction === null ? null : toClearingDto(transaction),
    timeline: toTimelineDto(events),
  };
}
