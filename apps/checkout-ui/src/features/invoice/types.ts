import type { MerchantRef, MoneyDto } from "../../shared/types.ts";

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
