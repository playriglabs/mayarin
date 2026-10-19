/**
 * Fraud detection (FDS): what is known about a payment when it is assessed, and
 * what the assessment says.
 *
 * The outcome reuses the screening vocabulary on purpose. `BLOCKED` and `REVIEW`
 * already mean "refuse" and "a person should look", and a payment carries one
 * word for that, not two.
 */

import type { ScreeningOutcome } from "@mayarin/compliance";
import type { AssetCode } from "@mayarin/shared";

export type RiskOutcome = Exclude<ScreeningOutcome, "NOT_SCREENED">;

export interface RiskFacts {
  readonly merchantId: string;
  readonly paymentIntentId: string;
  /** The payer's on-chain address, when the path exposes one. Deposit-match does not. */
  readonly payer?: string;
  /** Amount in minor units of `asset`, the currency the merchant priced in. */
  readonly amount: bigint;
  readonly asset: AssetCode;
}

export interface RiskSignal {
  readonly rule: string;
  /** `block` refuses the payment; `review` only flags it. */
  readonly action: "block" | "review";
  readonly detail: string;
}

export interface RiskAssessment {
  readonly paymentIntentId: string;
  readonly merchantId: string;
  readonly payer: string | undefined;
  readonly outcome: RiskOutcome;
  readonly signals: readonly RiskSignal[];
  readonly assessedAt: Date;
}

/** Thresholds, all integers. A rule with no threshold set is off. */
export interface RiskRules {
  /** Window every velocity and history count looks back over. */
  readonly windowSeconds: number;
  /** Intents from one payer inside the window at or above this → review. */
  readonly payerAttempts?: number;
  /** Intents on one merchant inside the window at or above this → review. */
  readonly merchantAttempts?: number;
  /** A payment above `spikeFactor` times the merchant's largest in the window → review. */
  readonly spikeFactor?: number;
  /** A spike means nothing for a merchant with fewer paid payments than this. */
  readonly spikeMinHistory?: number;
}

/** What Mayarin already holds about recent activity; counted, not stored again. */
export interface RiskHistory {
  payerAttempts(payer: string, since: Date): Promise<number>;
  merchantAttempts(merchantId: string, since: Date): Promise<number>;
  /** Paid payments of the merchant in `asset` since `since`: how many, and the largest. */
  merchantPaid(
    merchantId: string,
    asset: AssetCode,
    since: Date,
  ): Promise<{ readonly count: number; readonly largest: bigint }>;
}

/** Addresses nobody may pay from. Case-insensitive. */
export interface Denylist {
  has(address: string): Promise<boolean>;
}
