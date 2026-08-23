import type { DecimalMoneyRequest } from "@/types/catalog";
import type { MoneyDto } from "@/types/payment";

export type InvoiceState = "draft" | "issued" | "void";
export type InvoiceStatus = "draft" | "issued" | "partially_paid" | "paid" | "overdue" | "void";

export interface InvoiceBuyerDto {
  readonly name: string;
  readonly email: string | null;
  readonly taxId: string | null;
  readonly address: string | null;
}

export interface InvoiceLineDto {
  readonly name: string;
  readonly unitPrice: MoneyDto;
  readonly quantity: number;
}

export interface InvoiceDto {
  readonly id: string;
  readonly number: string | null;
  readonly state: InvoiceState;
  readonly status: InvoiceStatus;
  readonly buyer: InvoiceBuyerDto;
  readonly currency: string;
  readonly lines: readonly InvoiceLineDto[];
  readonly total: MoneyDto;
  readonly paid: MoneyDto;
  readonly outstanding: MoneyDto;
  readonly notes: string | null;
  /** Public hosted page the merchant sends to the client. */
  readonly url: string;
  readonly issuedAt: string | null;
  readonly dueAt: string | null;
  readonly voidedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
}

export interface InvoiceListResponse {
  readonly invoices: readonly InvoiceDto[];
}

export interface InvoiceResponse {
  readonly invoice: InvoiceDto;
}

export interface InvoiceEmailResponse {
  readonly delivery: {
    readonly id: string;
    readonly recipient: string;
  };
}

export interface CreateInvoiceLineRequest {
  readonly name: string;
  readonly unitPrice: DecimalMoneyRequest;
  readonly quantity: number;
}

export interface CreateInvoiceRequest {
  readonly buyer: {
    readonly name: string;
    readonly email?: string;
    readonly taxId?: string;
    readonly address?: string;
  };
  readonly currency: string;
  readonly lines: readonly CreateInvoiceLineRequest[];
  readonly dueAt: string;
  readonly notes?: string;
}

export interface IssueInvoiceRequest {
  readonly id: string;
  readonly dueAt: string;
}
