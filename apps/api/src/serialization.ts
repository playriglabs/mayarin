/**
 * Response shapes.
 *
 * JSON has no bigint, so money crosses the wire as an exact minor-unit string
 * plus two rendered forms. Clients that do arithmetic use `amount`; clients that
 * parse a decimal use `formatted`; clients that show the amount to a person use
 * `display`, which follows the market's own conventions — Indonesia writes
 * fifty thousand four hundred thirty-two rupiah as `Rp 50.432,00`.
 */

import type { ClearingEvent, ClearingTransaction } from "@mayarin/clearing";
import type { PaymentIntent } from "@mayarin/payment-intent";
import { formatMoneyLocale, type Money, toDecimalString } from "@mayarin/shared";

export interface MoneyDto {
  readonly amount: string;
  readonly asset: string;
  /** Machine-readable decimal, always dot-separated and ungrouped. */
  readonly formatted: string;
  /** Human-readable, localized. Never parse this. */
  readonly display: string;
}

export function toMoneyDto(value: Money): MoneyDto {
  return {
    amount: value.amount.toString(),
    asset: value.asset,
    formatted: toDecimalString(value),
    display: formatMoneyLocale(value),
  };
}

function optionalMoney(value: Money | undefined): MoneyDto | undefined {
  return value === undefined ? undefined : toMoneyDto(value);
}

export function toPaymentIntentDto(intent: PaymentIntent) {
  return {
    id: intent.id,
    status: intent.status,
    merchant: intent.merchant,
    amount: toMoneyDto(intent.amount),
    settlementAsset: intent.settlementAsset,
    provider: intent.provider,
    source: intent.source,
    metadata: intent.metadata,
    clearingTransactionId: intent.clearingTransactionId ?? null,
    failureReason: intent.failureReason ?? null,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
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
            minorUnitsPerWholeUnit: transaction.rate.minorUnitsPerWholeUnit.toString(),
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

export function toPaymentDto(
  intent: PaymentIntent,
  transaction: ClearingTransaction | null,
  events: readonly ClearingEvent[] = [],
) {
  return {
    paymentIntent: toPaymentIntentDto(intent),
    clearing: transaction === null ? null : toClearingDto(transaction),
    timeline: toTimelineDto(events),
  };
}
