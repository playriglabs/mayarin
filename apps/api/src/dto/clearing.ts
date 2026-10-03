/**
 * Clearing transaction and timeline DTOs.
 */

import type { ClearingEvent, ClearingState, ClearingTransaction } from "@mayarin/clearing";
import type { AssetCode } from "@mayarin/shared";
import { type MoneyDto, optionalMoney, toMoneyDto } from "./money.ts";

export interface ClearingDto {
  readonly id: string;
  readonly state: ClearingState;
  readonly provider: string;
  readonly providerReference: string | null;
  readonly transactionHash: string | null;
  readonly sourceAmount: MoneyDto;
  readonly settlementAmount: MoneyDto | null;
  readonly fee: MoneyDto | null;
  readonly netAmount: MoneyDto | null;
  readonly rate: {
    readonly from: AssetCode;
    readonly to: AssetCode;
    readonly scaledRate: string;
    readonly source: string;
    readonly lockedAt: string;
  } | null;
  readonly failure: { readonly reason: string; readonly code: string; readonly at: string } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TimelineEntryDto {
  readonly sequence: number;
  readonly state: ClearingState;
  readonly from: ClearingState | null;
  readonly occurredAt: string;
}

export function toClearingDto(transaction: ClearingTransaction): ClearingDto {
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
export function toTimelineDto(events: readonly ClearingEvent[]): TimelineEntryDto[] {
  return events.map((event) => ({
    sequence: event.sequence,
    state: event.toState,
    from: event.fromState ?? null,
    occurredAt: event.occurredAt.toISOString(),
  }));
}
