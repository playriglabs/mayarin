/**
 * Refund request schema and response DTOs (#12).
 */

import type { Refund, RefundSummary } from "@mayarin/clearing";
import { decimalMoneySchema } from "@mayarin/shared";
import { z } from "zod";
import { toMoneyDto } from "./money.ts";

export const refundBodySchema = z
  .object({
    /** Omitted refunds everything still refundable. */
    amount: decimalMoneySchema.optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

export function toRefundDto(refund: Refund) {
  return {
    id: refund.id,
    paymentIntentId: refund.paymentIntentId,
    amount: toMoneyDto(refund.amount),
    state: refund.state,
    reason: refund.reason ?? null,
    providerReference: refund.providerReference ?? null,
    failureReason: refund.failureReason ?? null,
    createdAt: refund.createdAt.toISOString(),
    updatedAt: refund.updatedAt.toISOString(),
  };
}

/**
 * How much of a payment has come back.
 *
 * Derived from the refunds rather than stored on the payment: a payment that
 * flipped to a refunded status would lose the fact that it succeeded, which is
 * the fact the ledger is built on.
 */
export function toRefundSummaryDto(summary: RefundSummary) {
  return {
    refundable: toMoneyDto(summary.refundable),
    refunded: toMoneyDto(summary.refunded),
    remaining: toMoneyDto(summary.remaining),
    state: summary.state,
  };
}
