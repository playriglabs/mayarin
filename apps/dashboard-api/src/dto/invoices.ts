/**
 * Merchant dashboard invoice wire shapes.
 *
 * The dashboard never accepts a merchant id or merchant snapshot. Both come
 * from the authenticated session, so a browser cannot issue a document in
 * another merchant's name. Money arrives as decimal strings and is parsed by
 * the shared schema before it reaches the invoicing domain.
 */

import type { InvoiceView } from "@mayarin/invoicing";
import { assetCodeSchema, decimalMoneySchema, timestampSchema } from "@mayarin/shared";
import { z } from "zod";
import { toMoneyDto } from "./money.ts";

const buyerSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    email: z.string().trim().email().max(320).optional(),
    taxId: z.string().trim().min(1).max(64).optional(),
    address: z.string().trim().min(1).max(1_000).optional(),
  })
  .transform(({ name, email, taxId, address }) => ({
    name,
    ...(email === undefined ? {} : { email }),
    ...(taxId === undefined ? {} : { taxId }),
    ...(address === undefined ? {} : { address }),
  }));

const lineSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    unitPrice: decimalMoneySchema,
    quantity: z.number().int().positive().max(1_000_000),
  })
  .strict();

/** One dashboard action creates and issues a payable invoice. */
export const createInvoiceBodySchema = z
  .object({
    buyer: buyerSchema,
    currency: assetCodeSchema,
    lines: z.array(lineSchema).min(1).max(100),
    dueAt: timestampSchema,
    notes: z.string().trim().max(2_000).optional(),
  })
  .strict();

/** Used to recover a draft if an earlier create succeeded but issue failed. */
export const issueInvoiceBodySchema = z.object({ dueAt: timestampSchema }).strict();

/**
 * One deliberate delivery attempt. Reusing it is safe; a later click creates a
 * new UUID so Resend does not confuse an intentional resend with a retry.
 */
export const sendInvoiceBodySchema = z.object({ deliveryId: z.string().uuid() }).strict();

/**
 * An invoice list row includes derived payment state. The buyer page and the
 * merchant dashboard therefore read the same outstanding balance and status.
 */
export function toInvoiceViewDto(view: InvoiceView, checkoutBaseUrl: string) {
  const { invoice } = view;
  return {
    id: invoice.id,
    number: invoice.number ?? null,
    state: invoice.state,
    status: view.status,
    buyer: {
      name: invoice.buyer.name,
      email: invoice.buyer.email ?? null,
      taxId: invoice.buyer.taxId ?? null,
      address: invoice.buyer.address ?? null,
    },
    currency: invoice.currency,
    lines: invoice.lines.map((line) => ({
      name: line.name,
      unitPrice: toMoneyDto(line.unitPrice),
      quantity: line.quantity,
    })),
    total: toMoneyDto(invoice.total),
    paid: toMoneyDto(view.paid),
    outstanding: toMoneyDto(view.outstanding),
    notes: invoice.notes ?? null,
    url: `${checkoutBaseUrl}/invoices/${invoice.id}/view`,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    dueAt: invoice.dueAt?.toISOString() ?? null,
    voidedAt: invoice.voidedAt?.toISOString() ?? null,
    createdAt: invoice.createdAt.toISOString(),
    updatedAt: invoice.updatedAt.toISOString(),
    version: invoice.version,
  };
}
