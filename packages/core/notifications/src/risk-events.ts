/**
 * The webhook event of a payment the fraud rules did not clear (FDS).
 *
 * `payment.flagged` covers both verdicts: `REVIEW` went ahead and wants a look,
 * `BLOCKED` was refused. The id is the intent's, so a retried confirm does not
 * send it twice.
 */

import type { MerchantEvent } from "./merchant-event.ts";

export interface RiskFacts {
  readonly paymentIntentId: string;
  readonly payer: string | undefined;
  readonly outcome: string;
  readonly signals: readonly { readonly rule: string; readonly detail: string }[];
  readonly assessedAt: Date;
}

export function paymentFlaggedEvent(assessment: RiskFacts): MerchantEvent {
  return {
    id: `${assessment.paymentIntentId}:flagged`,
    type: "payment.flagged",
    occurredAt: assessment.assessedAt,
    data: {
      paymentIntentId: assessment.paymentIntentId,
      outcome: assessment.outcome,
      payer: assessment.payer ?? null,
      signals: assessment.signals.map(({ rule, detail }) => ({ rule, detail })),
    },
  };
}
