/**
 * Payment documents (#293).
 *
 * An invoice and a receipt for one payment, as values a renderer prints. Both
 * are derived on request from inputs that are already immutable — the intent's
 * merchant snapshot, its cart snapshot, the invoice it was minted from, and the
 * clearing transaction's locked amounts — so nothing here is stored, and a
 * re-render always prints the same document.
 */

import type { AssetCode, Money } from "@mayarin/shared";

export const DOCUMENT_KINDS = ["invoice", "receipt"] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** A name plus the lines printed under it, in order. */
export interface DocumentParty {
  readonly name: string;
  readonly lines: readonly string[];
  /** The party's logo, a public PNG or JPEG. Only the seller has one. */
  readonly logoUrl?: string;
}

export interface DocumentLine {
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly amount: Money;
}

/**
 * The rate the payment cleared at: one whole unit of `from` was worth `per`.
 *
 * Derived from the two amounts clearing actually froze — the merchant's price
 * and the settlement amount — rather than read off a locked rate, which on the
 * deposit path can name the settlement-to-payer leg (`USDG → USDG`) and carries
 * the `RATE_SCALE` factor a reader should never see.
 */
export interface DocumentRate {
  readonly from: AssetCode;
  readonly per: Money;
}

/**
 * How the payment was actually made — the part of a receipt a card processor
 * prints as "Visa - 2778", and an on-chain clearing layer can print as proof.
 */
export interface PaymentProof {
  /** What the payer sent, in the asset they sent it in. */
  readonly paidWith?: Money;
  readonly network?: string;
  readonly rate?: DocumentRate;
  /** What cleared in the settlement asset, before the fee. */
  readonly settled?: Money;
  readonly fee?: Money;
  /** What the merchant received. */
  readonly net?: Money;
  readonly transactionHash?: string;
  readonly explorerUrl?: string;
}

export interface PaymentDocument {
  readonly kind: DocumentKind;
  readonly paymentId: string;
  readonly invoiceNumber: string;
  /** Present on a receipt only. */
  readonly receiptNumber?: string;
  readonly issuedAt: Date;
  readonly dueAt?: Date;
  /** Present on a receipt only. */
  readonly paidAt?: Date;
  readonly seller: DocumentParty;
  readonly billTo?: DocumentParty;
  readonly memo?: string;
  readonly lines: readonly DocumentLine[];
  readonly total: Money;
  /** Present on a receipt only. */
  readonly payment?: PaymentProof;
}
