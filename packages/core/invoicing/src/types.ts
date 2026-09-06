/**
 * Invoicing values.
 *
 * An invoice is a payment link that also remembers who it was sent to, when it
 * falls due, and what number the buyer's own accounting will file it under. It
 * mints Payment Intents through the commerce layer and settles through none of
 * its own machinery — the contract boundary is the intent, exactly as it is for
 * a cart or a link.
 *
 * Two decisions are encoded in these types and are worth stating, because both
 * were arguable.
 *
 * **A buyer is a snapshot, not a record.** What an invoice says about its buyer
 * must not change when a buyer record is later edited: an issued invoice is a
 * document, and a document that rewrites itself is not one. This mirrors
 * `MerchantSnapshot` on an intent, and it keeps a CRM out of the domain, which
 * the commerce layer rejected for good reasons.
 *
 * **Stored state is small; status is mostly derived.** Only `draft`, `issued`
 * and `void` are persisted, because only those three are facts about the
 * document itself. Paid, partly paid and overdue are facts about payments and
 * the clock, so they are computed at read time from the intents that carry this
 * invoice's number. A stored `PAID` flag would drift the moment a payment
 * completed and nothing wrote the flag.
 */

import type { CartLine } from "@mayarin/catalog";
import type { MerchantSnapshot, PaymentRail } from "@mayarin/payment-intent";
import type { AssetCode, Money } from "@mayarin/shared";

/**
 * Who the invoice is addressed to.
 *
 * `taxId` is an Indonesian NPWP in practice, held as free text because this
 * layer does not validate a tax identity it cannot verify. Only `name` is
 * required: a merchant issuing to a walk-in company knows the name long before
 * the finance details arrive.
 */
export interface BuyerSnapshot {
  readonly name: string;
  readonly email?: string;
  readonly taxId?: string;
  readonly address?: string;
}

/**
 * The states an invoice actually stores.
 *
 * `void` is terminal and deliberately not called `cancelled` — accounting voids
 * a document, it does not delete it, and the number stays consumed so the
 * sequence keeps its meaning.
 */
export const INVOICE_STATES = ["draft", "issued", "void"] as const;

export type InvoiceState = (typeof INVOICE_STATES)[number];

/**
 * What a reader is shown, once payments and the clock are taken into account.
 *
 * A superset of `InvoiceState`: the three stored states pass through, and the
 * other three are computed. Nothing persists this.
 */
export const INVOICE_STATUSES = [
  "draft",
  "issued",
  "partially_paid",
  "paid",
  "overdue",
  "void",
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/**
 * A line on an invoice.
 *
 * The same shape a priced cart line takes, reused rather than redeclared: an
 * invoice line is a cart line that happens to be printed. Reusing it means
 * `priceCart` totals an invoice without a translation step, and a line's price
 * is frozen at the moment it is written, never re-read from the product.
 */
export type InvoiceLine = CartLine;

export interface Invoice {
  readonly id: string;
  readonly merchantId: string;
  /**
   * Merchant details as they were when the invoice was raised. A snapshot for
   * the same reason the buyer is one: the document must stay readable after the
   * merchant record changes.
   */
  readonly merchant: MerchantSnapshot;
  /**
   * The merchant-facing invoice number. Absent while the invoice is a draft —
   * a number is allocated once, at issue, and never reallocated.
   */
  readonly number?: string;
  /** The allocator's raw counter value behind `number`. Absent on a draft. */
  readonly sequence?: number;
  readonly state: InvoiceState;
  readonly buyer: BuyerSnapshot;
  readonly currency: AssetCode;
  /** Never empty. Prices are frozen here, not resolved from the catalog later. */
  readonly lines: readonly InvoiceLine[];
  readonly total: Money;
  readonly notes?: string;
  /** Set at issue, alongside `number`. */
  readonly issuedAt?: Date;
  /** Set at issue. Overdue derives from this and the clock, never from a flag. */
  readonly dueAt?: Date;
  readonly voidedAt?: Date;
  readonly metadata: Readonly<Record<string, string>>;
  readonly idempotencyKey?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Incremented on every transition. The optimistic-locking token. */
  readonly version: number;
}

/**
 * An invoice plus everything derived from its payments.
 *
 * Returned by reads rather than stored, so a caller never has to know which
 * fields are facts about the document and which are facts about money.
 */
export interface InvoiceView {
  readonly invoice: Invoice;
  readonly status: InvoiceStatus;
  readonly paid: Money;
  readonly outstanding: Money;
  /**
   * What was paid, and on what. Oldest first, so a part-paid invoice reads down
   * the page in the order the money arrived.
   */
  readonly payments: readonly InvoicePayment[];
}

/**
 * One completed payment against an invoice.
 *
 * A document that has been paid should say what it was paid *with*: "USDC on
 * Arc" is the answer a buyer checking their wallet and a finance team
 * reconciling a bank of chains both need, and neither can get it from a status
 * badge. `amount` is in the invoice's own currency — the same figure that sums
 * to `paid` — because that is what the document is denominated in.
 */
export interface InvoicePayment {
  readonly intentId: string;
  readonly amount: Money;
  /** Absent on a fiat-only intent, which has no chain to name. */
  readonly rail?: PaymentRail;
  readonly paidAt: Date;
}
