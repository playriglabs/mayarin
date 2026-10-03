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
