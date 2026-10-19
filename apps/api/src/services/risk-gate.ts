/**
 * The fraud gate (FDS), run when a payment is confirmed.
 *
 * Assesses the intent, records anything that was not clear, tells the merchant
 * by webhook (`payment.flagged`), and returns whether to refuse. Only a block
 * refuses; a review is a flag on a payment that goes ahead.
 *
 * It fails open. If the rules cannot be evaluated (the database is down), the
 * payment is let through and the failure is logged: the same database failure
 * would already be failing the payment itself, and a gate that took checkout
 * down with it would cost more than the rules save.
 */

import type { DrizzleRiskAssessments } from "@mayarin/db";
import type { RiskAssessor } from "@mayarin/fraud";
import {
  enqueueMerchantEvent,
  type MerchantEventSink,
  paymentFlaggedEvent,
} from "@mayarin/notifications";
import type { PaymentIntent, RiskGate } from "@mayarin/payment-intent";
import { type Clock, generateId, ID_PREFIXES } from "@mayarin/shared";

export interface RiskGateOptions {
  readonly assessor: RiskAssessor;
  readonly assessments: Pick<DrizzleRiskAssessments, "record">;
  /** Absent when webhooks are off on this deployment. */
  readonly webhooks?: MerchantEventSink;
  readonly clock: Clock;
}

export class RiskGateService implements RiskGate {
  readonly #options: RiskGateOptions;

  constructor(options: RiskGateOptions) {
    this.#options = options;
  }

  async check(intent: PaymentIntent): Promise<{ readonly blocked: boolean }> {
    const { assessor, assessments, webhooks, clock } = this.#options;
    try {
      const merchantId = intent.ownerMerchantId ?? intent.merchant.id;
      const assessment = await assessor.assess({
        merchantId,
        paymentIntentId: intent.id,
        ...(intent.payment?.payerAddress === undefined
          ? {}
          : { payer: intent.payment.payerAddress }),
        amount: intent.amount.amount,
        asset: intent.amount.asset,
      });
      if (assessment.outcome === "CLEAR") return { blocked: false };

      await assessments.record(
        generateId(ID_PREFIXES.riskAssessment, clock.now().getTime()),
        assessment,
      );
      if (webhooks !== undefined) {
        await enqueueMerchantEvent(
          webhooks,
          merchantId,
          paymentFlaggedEvent(assessment),
          clock.now(),
        );
      }
      return { blocked: assessment.outcome === "BLOCKED" };
    } catch (error) {
      console.error(
        `[risk-gate] could not assess ${intent.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { blocked: false };
    }
  }
}
