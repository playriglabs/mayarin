/**
 * The bootstrap contract (#151).
 *
 * The API injects one of these into the shell as `window.__BOOTSTRAP__`, so the
 * page paints from data it already has — no fetch, no spinner. Mirrored by hand
 * from the payloads the API builds (`apps/api/src/routes/checkout-page.ts`,
 * `invoice-page.ts`), the same way `apps/demo` mirrors the SDK's DTOs. The API's
 * endpoint tests pin the shape on the other side of the seam.
 */

/** Money on the wire. `display` is for people; never parse it. */
export interface MoneyDto {
  readonly amount: string;
  readonly asset: string;
  readonly formatted: string;
  readonly display: string;
}

export interface MerchantRef {
  readonly name: string;
  readonly city: string;
}

export interface LinkLine {
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly quantity: number;
  readonly unitPrice: MoneyDto;
  readonly lineTotal: MoneyDto;
}

/** The link page: what is being sold, in what asset, and one button. */
export interface LinkBootstrap {
  readonly page: "link";
  readonly linkId: string;
  readonly kind: "fixed" | "open" | "catalog";
  readonly title: string;
  readonly merchant: MerchantRef;
  readonly payable: boolean;
  /** The currency an `open` link asks the buyer to type an amount in. */
  readonly currency: string | null;
  /** The priced total. `null` for an `open` link, which has none until the buyer types. */
  readonly total: MoneyDto | null;
  /** Catalog lines, so a buyer can check what they are paying for. */
  readonly lines: readonly LinkLine[] | null;
  readonly accepted: readonly string[];
  /** Where the payer sends funds — the chain the minted intent will be watched on. */
  readonly chain: string;
  readonly lockMinutes: number;
}

/** The payment page: exactly what to send, where, and how long is left. */
export interface PayBootstrap {
  readonly page: "pay";
  readonly intentId: string;
  readonly amount: MoneyDto;
  readonly merchant: MerchantRef;
  readonly title: string;
  readonly lines: readonly LinkLine[] | null;
  readonly expiresAt: string;
  readonly statusUrl: string;
  readonly streaming: boolean;
  readonly successUrl: string | null;
  readonly pollMs: number;
}

export interface InvoiceLine {
  readonly name: string;
  readonly quantity: number;
  readonly unitPrice: MoneyDto;
  readonly lineTotal: MoneyDto;
}

export interface InvoiceBuyer {
  readonly name: string;
  readonly email: string | null;
  readonly taxId: string | null;
  readonly address: string | null;
}

export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "void";

/** The invoice page: a document on screen, and the same document on paper. */
export interface InvoiceBootstrap {
  readonly page: "invoice";
  readonly invoiceId: string;
  readonly number: string | null;
  readonly status: InvoiceStatus;
  readonly merchant: MerchantRef;
  readonly buyer: InvoiceBuyer;
  readonly lines: readonly InvoiceLine[];
  readonly total: MoneyDto;
  readonly paid: MoneyDto;
  readonly outstanding: MoneyDto;
  readonly notes: string | null;
  readonly issuedAt: string | null;
  readonly dueAt: string | null;
  readonly payable: boolean;
  readonly accepted: readonly string[];
  readonly chain: string;
  readonly checkoutUrl: string;
}

export type Bootstrap = LinkBootstrap | PayBootstrap | InvoiceBootstrap;

/** What the status endpoint returns, as far as this page reads it. */
export interface PaymentStatusPayload {
  readonly paymentIntent: {
    readonly status: string;
    readonly failureReason?: string | null;
  };
  /** The clearing engine's own state — the only field that knows whether money arrived. */
  readonly clearing?: {
    readonly state: string;
  } | null;
  readonly deposit?: {
    readonly uri: string | null;
    readonly amount: MoneyDto;
    readonly chain: string;
    readonly address: string;
    readonly received: MoneyDto;
  } | null;
}

declare global {
  interface Window {
    __BOOTSTRAP__?: Bootstrap;
  }
}
