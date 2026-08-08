/**
 * Commerce layer values.
 *
 * The whole layer is optional: payments work end to end without a single
 * product row. What lives here produces Payment Intents and never anything
 * else — the contract boundary with the rest of Mayarin is the intent, not the
 * product.
 */

import type { MerchantSnapshot } from "@mayarin/payment-intent";
import type { AssetCode, Money } from "@mayarin/shared";

/**
 * A sellable item.
 *
 * `prices` carries one amount per currency the merchant has priced in, entered
 * by the merchant rather than converted from a base price. Converting at read
 * time would make the displayed price move with an FX feed between the moment a
 * buyer reads it and the moment they pay, which is a support ticket, not a
 * feature. Multi-currency is therefore a data shape, not a calculation.
 */
export interface Product {
  readonly id: string;
  readonly merchantId: string;
  /** Merchant's own item code. Unique per merchant. */
  readonly sku: string;
  readonly name: string;
  readonly description?: string;
  readonly prices: readonly Money[];
  /** An inactive product still resolves for old intents but cannot be sold. */
  readonly active: boolean;
  readonly metadata: Readonly<Record<string, string>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Incremented on every edit. The optimistic-locking token. */
  readonly version: number;
}

/**
 * What a payment link asks the buyer for.
 *
 * - `fixed` — one amount decided when the link was made.
 * - `open` — the buyer enters the amount, in `currency`. This is what a printed
 *   merchant QR is: one code on the counter, a different amount every time.
 * - `catalog` — priced from the merchant's own products at checkout time.
 *
 * A merchant with no catalog can still sell through the first two, which is the
 * point: the catalog must never be on the path between a merchant and their
 * money.
 */
export const PAYMENT_LINK_KINDS = ["fixed", "open", "catalog"] as const;

export type PaymentLinkKind = (typeof PAYMENT_LINK_KINDS)[number];

/** One catalog line on a link, resolved to a price only at checkout. */
export interface PaymentLinkLine {
  readonly productId: string;
  readonly quantity: number;
}

export interface PaymentLink {
  readonly id: string;
  readonly kind: PaymentLinkKind;
  /**
   * Merchant details as they were when the link was made. A snapshot for the
   * same reason the intent keeps one: what a buyer was shown must stay readable
   * after the merchant record changes.
   */
  readonly merchant: MerchantSnapshot;
  /** Present iff `kind` is `fixed`. */
  readonly amount?: Money;
  /**
   * The currency this link prices in. Present for `open` (what the buyer enters
   * an amount in) and for `catalog` (which of a product's prices applies);
   * absent for `fixed`, whose `amount` already names one.
   */
  readonly currency?: AssetCode;
  /** Present iff `kind` is `catalog`. Never empty. */
  readonly lines?: readonly PaymentLinkLine[];
  /** Free-text title shown on the hosted page. */
  readonly title?: string;
  /** The merchant's own order/reference id, copied onto every intent this link mints. */
  readonly merchantReference?: string;
  readonly metadata: Readonly<Record<string, string>>;
  /**
   * When the link stops being payable. Absent means it does not expire on its
   * own — a counter QR outlives any single sale.
   */
  readonly expiresAt?: Date;
  /** Set when the merchant retires the link. Independent of expiry. */
  readonly disabledAt?: Date;
  readonly idempotencyKey?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

/**
 * One priced line in a cart.
 *
 * `unitPrice` is resolved once, at pricing time, and then frozen into the
 * intent's snapshot. A line does not hold a product reference in order to
 * re-read the price later — re-reading is exactly what must not happen.
 */
export interface CartLine {
  /** Absent for an ad-hoc line a cashier typed in. */
  readonly productId?: string;
  readonly name: string;
  readonly unitPrice: Money;
  readonly quantity: number;
}

/** What a cart folds down to: one amount, plus the lines that justify it. */
export interface CartTotal {
  readonly total: Money;
  readonly lines: readonly CartLine[];
}
