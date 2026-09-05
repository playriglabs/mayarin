/**
 * Commerce wire types, mirrored from the dashboard API DTOs (#15).
 *
 * Neither shape carries a merchant: the dashboard's merchant is the session's,
 * and the server takes it from there. Money crosses the wire as `MoneyDto` —
 * a minor-unit string plus rendered forms — exactly as it does for payments.
 */

import type { MoneyDto } from "@/types/payment";

export interface ProductDto {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly description: string | null;
  /** One price per currency the merchant prices in. Never converted at read time. */
  readonly prices: readonly MoneyDto[];
  readonly active: boolean;
  readonly metadata: Readonly<Record<string, string>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface ProductListResponse {
  readonly products: readonly ProductDto[];
  readonly nextCursor: string | null;
}

export interface ProductResponse {
  readonly product: ProductDto;
}

/** Money as a human writes it — `{ amount: "50000.00", asset: "IDR" }`. */
export interface DecimalMoneyRequest {
  readonly amount: string;
  readonly asset: string;
}

export interface CreateProductRequest {
  readonly sku: string;
  readonly name: string;
  readonly description?: string;
  readonly prices: readonly DecimalMoneyRequest[];
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface UpdateProductRequest {
  readonly name?: string;
  /** `null` clears it; an absent field leaves it alone. */
  readonly description?: string | null;
  readonly prices?: readonly DecimalMoneyRequest[];
  readonly active?: boolean;
  /** Replaced wholesale when present, so removing a pair is sending the rest. */
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * - `fixed` — one amount, decided when the link was made.
 * - `open` — the buyer enters the amount. What a printed counter QR is.
 * - `catalog` — priced from the merchant's own products at checkout time.
 */
export type PaymentLinkKind = "fixed" | "open" | "catalog";

export interface PaymentLinkLine {
  readonly productId: string;
  readonly quantity: number;
}

export interface PaymentLinkDto {
  readonly id: string;
  readonly kind: PaymentLinkKind;
  readonly amount: MoneyDto | null;
  readonly currency: string | null;
  readonly lines: readonly PaymentLinkLine[] | null;
  readonly title: string | null;
  readonly merchantReference: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  /** Hosted checkout URL on the payment API — what a QR encodes. */
  readonly url: string;
  /** False once disabled or expired. A link is a template, not a payment. */
  readonly payable: boolean;
  readonly expiresAt: string | null;
  readonly disabledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface PaymentLinkListResponse {
  readonly paymentLinks: readonly PaymentLinkDto[];
  readonly nextCursor: string | null;
}

export interface ProductOptionsResponse {
  readonly products: readonly ProductDto[];
}

export interface PaymentLinkResponse {
  readonly paymentLink: PaymentLinkDto;
}

export interface CreateLinkRequest {
  readonly kind: PaymentLinkKind;
  /** `fixed` only. */
  readonly amount?: DecimalMoneyRequest;
  /** `open` and `catalog`. */
  readonly currency?: string;
  /** `catalog` only. */
  readonly lines?: readonly PaymentLinkLine[];
  readonly title?: string;
  readonly merchantReference?: string;
}

/** What a counter sale needs beyond the link: the asset the payer will send. */
export interface ChargeLinkRequest {
  readonly linkId: string;
  readonly asset: string;
  /** Which network the payer sends on (#244). The address they scan belongs to it. */
  readonly chain: string;
  /** Required by an `open` link, refused by the others. */
  readonly amount?: DecimalMoneyRequest;
}

export interface ChargeLinkResponse {
  readonly paymentIntentId: string;
}

/** What one accepted asset would take. `null` amount = no rate available. */
export interface QuoteLine {
  readonly asset: string;
  readonly amount: { readonly amount: string; readonly display: string } | null;
  readonly available: boolean;
  /** Why it could not be priced. Present only on an unavailable line. */
  readonly reason?: string;
}

export interface QuoteResponse {
  readonly source: { readonly display: string };
  readonly quotes: readonly QuoteLine[];
  /** Always true: nothing here is locked until the payment is confirmed. */
  readonly indicative: boolean;
}

export interface QuoteRequest {
  readonly linkId: string;
  /** Required by an `open` link; the others carry their own amount. */
  readonly amount?: DecimalMoneyRequest;
}
