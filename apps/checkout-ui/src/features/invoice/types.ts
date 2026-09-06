import type { MerchantRef, MoneyDto, Rail } from "../../shared/types.ts";

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

/**
 * One completed payment against the invoice.
 *
 * `rail` is what the document is missing without this: a paid invoice that
 * names only a figure makes a buyer open a block explorer to find out whether
 * the USDC they sent on Arc landed here. `null` for a fiat-only intent, which
 * has no chain to name.
 */
export interface InvoicePaymentRecord {
  readonly intentId: string;
  readonly amount: MoneyDto;
  readonly rail: { readonly asset: string; readonly chain: string } | null;
  readonly paidAt: string;
}

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
  /** Every rail this invoice can be paid on (#244), from the same catalog the link page reads. */
  readonly rails: readonly Rail[];
  /** What has been paid, and on what. Oldest first. Empty until the first payment completes. */
  readonly payments: readonly InvoicePaymentRecord[];
  readonly checkoutUrl: string;
}
