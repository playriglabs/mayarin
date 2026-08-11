/**
 * Invoice request schemas and response DTOs (#112).
 *
 * Request validation lives with the DTO it produces, so "an invoice" means one
 * thing in every route that touches it.
 *
 * The wire shape carries the derived figures — status, paid, outstanding —
 * alongside the stored ones. A client must never have to fetch the payments
 * itself and re-derive what is owed, because two implementations of that sum
 * will eventually disagree, and the one on a buyer's screen is the one that
 * matters.
 */

import type { Invoice, InvoiceView } from "@mayarin/invoicing";
import { assetCodeSchema, decimalMoneySchema, timestampSchema } from "@mayarin/shared";
import { z } from "zod";
import { toMoneyDto } from "./money.ts";
import { merchantSchema } from "./payment-intent.ts";

const metadataSchema = z.record(z.string(), z.string()).optional();

const buyerSchema = z
  .object({
    name: z.string().min(1).max(255),
    email: z.string().email().max(320).optional(),
    /** NPWP in practice. Free text: this layer cannot verify a tax identity. */
    taxId: z.string().min(1).max(64).optional(),
    address: z.string().min(1).max(1_000).optional(),
  })
  // `exactOptionalPropertyTypes`: an optional field must be absent, never an
  // explicit `undefined`.
  .transform(({ name, email, taxId, address }) => ({
    name,
    ...(email === undefined ? {} : { email }),
    ...(taxId === undefined ? {} : { taxId }),
    ...(address === undefined ? {} : { address }),
  }));

/**
 * A line as written on the invoice.
 *
 * Unlike a cart line, this never takes a bare `productId`: an invoice freezes
 * its prices at the moment it is written, so the price arrives with the line
 * rather than being resolved from the catalog later.
 */
const invoiceLineSchema = z
  .object({
    productId: z.string().min(1).optional(),
    name: z.string().min(1).max(255),
    unitPrice: decimalMoneySchema,
    quantity: z.number().int().positive(),
  })
  .transform(({ productId, name, unitPrice, quantity }) => ({
    ...(productId === undefined ? {} : { productId }),
    name,
    unitPrice,
    quantity,
  }));

export const createInvoiceBodySchema = z
  .object({
    merchantId: z.string().min(1),
    merchant: merchantSchema,
    buyer: buyerSchema,
    currency: assetCodeSchema,
    lines: z.array(invoiceLineSchema).min(1),
    notes: z.string().max(2_000).optional(),
    metadata: metadataSchema,
  })
  .strict();

export const editInvoiceBodySchema = z
  .object({
    buyer: buyerSchema.optional(),
    lines: z.array(invoiceLineSchema).min(1).optional(),
    notes: z.string().max(2_000).optional(),
    metadata: metadataSchema,
  })
  .strict();

export const issueInvoiceBodySchema = z
  .object({
    dueAt: timestampSchema,
    prefix: z.string().min(1).max(16).optional(),
    includeYear: z.boolean().optional(),
  })
  .strict();

export const checkoutInvoiceBodySchema = z
  .object({
    /** Defaults to the outstanding balance. Never more than it. */
    amount: decimalMoneySchema.optional(),
  })
  .strict();

export type CreateInvoiceBody = z.input<typeof createInvoiceBodySchema>;
export type EditInvoiceBodyDto = z.input<typeof editInvoiceBodySchema>;
export type IssueInvoiceBodyDto = z.input<typeof issueInvoiceBodySchema>;
export type CheckoutInvoiceBody = z.input<typeof checkoutInvoiceBodySchema>;

type EditInvoiceBody = z.infer<typeof editInvoiceBodySchema>;
type IssueInvoiceBody = z.infer<typeof issueInvoiceBodySchema>;

/** Drops absent fields rather than passing them through as `undefined`. */
export function toEditInvoiceInput(body: EditInvoiceBody) {
  return {
    ...(body.buyer === undefined ? {} : { buyer: body.buyer }),
    ...(body.lines === undefined ? {} : { lines: body.lines }),
    ...(body.notes === undefined ? {} : { notes: body.notes }),
    ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
  };
}

export function toIssueInvoiceCommand(body: IssueInvoiceBody) {
  const format = {
    ...(body.prefix === undefined ? {} : { prefix: body.prefix }),
    ...(body.includeYear === undefined ? {} : { includeYear: body.includeYear }),
  };
  return {
    dueAt: body.dueAt,
    ...(Object.keys(format).length === 0 ? {} : { format }),
  };
}

/**
 * An invoice on the wire.
 *
 * `url` is what a merchant sends a buyer, served rather than left for a client
 * to assemble from a base URL it would have to be told separately — the same
 * reasoning as a payment link.
 */
export function toInvoiceDto(invoice: Invoice, baseUrl: string) {
  return {
    id: invoice.id,
    merchantId: invoice.merchantId,
    merchant: invoice.merchant,
    number: invoice.number ?? null,
    sequence: invoice.sequence ?? null,
    state: invoice.state,
    buyer: {
      name: invoice.buyer.name,
      email: invoice.buyer.email ?? null,
      taxId: invoice.buyer.taxId ?? null,
      address: invoice.buyer.address ?? null,
    },
    currency: invoice.currency,
    lines: invoice.lines.map((line) => ({
      productId: line.productId ?? null,
      name: line.name,
      unitPrice: toMoneyDto(line.unitPrice),
      quantity: line.quantity,
    })),
    total: toMoneyDto(invoice.total),
    notes: invoice.notes ?? null,
    metadata: invoice.metadata,
    url: `${baseUrl}/invoices/${invoice.id}/view`,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    dueAt: invoice.dueAt?.toISOString() ?? null,
    voidedAt: invoice.voidedAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    version: invoice.version,
  };
}

export type InvoiceDto = ReturnType<typeof toInvoiceDto>;

/** The invoice with everything derived from its payments, which is what a reader wants. */
export function toInvoiceViewDto(view: InvoiceView, baseUrl: string) {
  return {
    ...toInvoiceDto(view.invoice, baseUrl),
    status: view.status,
    paid: toMoneyDto(view.paid),
    outstanding: toMoneyDto(view.outstanding),
  };
}

export type InvoiceViewDto = ReturnType<typeof toInvoiceViewDto>;
