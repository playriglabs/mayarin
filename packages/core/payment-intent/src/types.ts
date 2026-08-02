import type { QrScheme } from "@mayarr/qr-parser";
import type { AssetCode, Money } from "@mayarr/shared";

/**
 * Payment intent lifecycle.
 *
 * `CREATED → CONFIRMED → PROCESSING → COMPLETED` is the happy path from the
 * README. `FAILED` and `EXPIRED` are the terminal outcomes that path can end in
 * — without them an intent whose clearing failed would be stuck in `PROCESSING`
 * forever, which is unrepresentable state, not a design choice.
 */
export const PAYMENT_INTENT_STATUSES = [
  "CREATED",
  "CONFIRMED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
] as const;

export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

/**
 * Merchant details as they were at intent creation.
 *
 * A snapshot, not a reference: what the payer agreed to pay must stay readable
 * even if the merchant record changes later.
 */
export interface MerchantSnapshot {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly countryCode: string;
  readonly categoryCode?: string;
}

/** Where the intent came from, kept for audit and provider re-presentation. */
export type PaymentSource =
  | { readonly type: "qr"; readonly scheme: QrScheme; readonly payload: string }
  | { readonly type: "manual" };

/**
 * An immutable payment request.
 *
 * Nothing mutates a `PaymentIntent`; transitions return a new value with an
 * incremented `version`, which is also the optimistic-locking token used by
 * repositories.
 */
export interface PaymentIntent {
  readonly id: string;
  readonly status: PaymentIntentStatus;
  readonly merchant: MerchantSnapshot;
  /** What the merchant is owed, denominated in the currency they quoted. */
  readonly amount: Money;
  /** Asset Mayarr clears and settles this payment in. */
  readonly settlementAsset: AssetCode;
  /** Settlement provider that will pay the merchant. */
  readonly provider: string;
  readonly source: PaymentSource;
  readonly metadata: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  /**
   * Fingerprint of the creating request. Lets a replayed idempotency key be
   * told apart from a key reused for different parameters.
   */
  readonly requestFingerprint?: string;
  /** Set once clearing starts; the clearing transaction is the execution record. */
  readonly clearingTransactionId?: string;
  readonly failureReason?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
  readonly confirmedAt?: Date;
  readonly completedAt?: Date;
  /** Incremented on every transition. Used for optimistic concurrency control. */
  readonly version: number;
}
