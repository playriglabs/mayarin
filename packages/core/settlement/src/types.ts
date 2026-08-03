import type { Money } from "@mayarin/shared";

/**
 * Lifecycle of a settlement at a provider.
 *
 * Deliberately coarse: every rail — QRIS, bank transfer, PayNow — collapses to
 * these four, and clearing must not learn provider-specific vocabulary.
 */
export type SettlementState = "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";

export const TERMINAL_SETTLEMENT_STATES: readonly SettlementState[] = [
  "SUCCEEDED",
  "FAILED",
  "REFUNDED",
];

/** Merchant details a rail needs to pay out. */
export interface SettlementMerchant {
  readonly id: string;
  readonly name: string;
  readonly city: string;
  readonly countryCode: string;
}

/**
 * What an adapter is asked to do.
 *
 * Note this is not a `PaymentIntent`: adapters receive exactly the facts a rail
 * needs, so a provider package never depends on Mayarin's aggregates and the
 * intent shape can evolve without touching every integration.
 */
export interface SettlementRequest {
  /** Mayarin's reference — the clearing transaction being settled. */
  readonly clearingTransactionId: string;
  readonly paymentIntentId: string;
  readonly merchant: SettlementMerchant;
  /** Amount to pay the merchant, denominated in the settlement asset. */
  readonly amount: Money;
  /**
   * Stable key for this settlement attempt. Adapters must treat a repeated key
   * as the same settlement — this is what makes the clearing engine resumable
   * without risking a double payout.
   */
  readonly idempotencyKey: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface SettlementResult {
  /** Identifier of the settlement at the provider. */
  readonly providerReference: string;
  readonly state: SettlementState;
  readonly settledAt?: Date;
  readonly failureReason?: string;
  /** Untouched provider response, kept for reconciliation and disputes. */
  readonly raw?: unknown;
}

export interface SettlementStatus {
  readonly providerReference: string;
  readonly state: SettlementState;
  readonly amount?: Money;
  readonly updatedAt: Date;
  readonly failureReason?: string;
  readonly raw?: unknown;
}

export interface RefundRequest {
  readonly providerReference: string;
  readonly idempotencyKey: string;
  /** Partial refunds are allowed where a rail supports them; omit for full. */
  readonly amount?: Money;
  readonly reason?: string;
}

export interface RefundResult {
  readonly providerReference: string;
  readonly refundReference: string;
  readonly state: SettlementState;
  readonly raw?: unknown;
}

/** Raw inbound webhook, before any provider-specific parsing or verification. */
export interface WebhookContext {
  readonly headers: Readonly<Record<string, string>>;
  readonly rawBody: string;
}

/**
 * Normalized outcome of a webhook.
 *
 * `null` means "understood, nothing to do" — providers routinely send events
 * Mayarin does not act on, and that is not an error.
 */
export interface SettlementWebhookEvent {
  readonly providerReference: string;
  /** Present when the provider echoes Mayarin's reference. */
  readonly clearingTransactionId?: string;
  readonly state: SettlementState;
  readonly occurredAt: Date;
  readonly failureReason?: string;
  readonly raw?: unknown;
}

/**
 * Provider abstraction.
 *
 * Business logic depends on this interface and never on an implementation, so
 * swapping QRIS for PayNow is configuration, not a rewrite.
 */
export interface SettlementAdapter {
  /** Registry key, also the `:provider` path segment of the webhook route. */
  readonly name: string;
  settle(request: SettlementRequest): Promise<SettlementResult>;
  status(providerReference: string): Promise<SettlementStatus>;
  refund(request: RefundRequest): Promise<RefundResult>;
  webhook(context: WebhookContext): Promise<SettlementWebhookEvent | null>;
}
