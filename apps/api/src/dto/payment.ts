/**
 * Payment DTO — one view combining the intent, clearing transaction, deposit
 * and timeline.
 */

import type { ClearingEvent, ClearingTransaction } from "@mayarin/clearing";
import type { PaymentIntent } from "@mayarin/payment-intent";
import {
  type ClearingDto,
  type TimelineEntryDto,
  toClearingDto,
  toTimelineDto,
} from "./clearing.ts";
import type { DepositDto } from "./deposit.ts";
import { type PaymentIntentDto, toPaymentIntentDto } from "./payment-intent.ts";

export function toPaymentDto(
  intent: PaymentIntent,
  transaction: ClearingTransaction | null,
  events: readonly ClearingEvent[] = [],
  deposit: DepositDto = null,
): PaymentDto {
  return {
    paymentIntent: toPaymentIntentDto(intent),
    clearing: transaction === null ? null : toClearingDto(transaction),
    deposit,
    timeline: toTimelineDto(events),
  };
}

export interface PaymentDto {
  readonly paymentIntent: PaymentIntentDto;
  readonly clearing: ClearingDto | null;
  readonly deposit: DepositDto;
  readonly timeline: readonly TimelineEntryDto[];
}

/**
 * What the payer is shown of their own payment (SEC-09): the intent, the
 * clearing state and the deposit to pay. Not the timeline, provider references,
 * fee, net amount, rate or failure internals, which are the merchant's record.
 */
export function toPayerPaymentDto(dto: PaymentDto): Omit<PaymentDto, "clearing" | "timeline"> & {
  readonly clearing: { readonly state: string } | null;
} {
  return {
    paymentIntent: dto.paymentIntent,
    clearing: dto.clearing === null ? null : { state: dto.clearing.state },
    deposit: dto.deposit,
  };
}
