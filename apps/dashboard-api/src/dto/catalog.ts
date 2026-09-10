/**
 * Commerce request schemas and response DTOs for the dashboard (#15).
 *
 * Mirrors the payment API's wire shape field for field, minus `merchantId` and
 * `merchant`: the dashboard's merchant is the one on the session, and a field
 * that cannot be sent cannot be forged. Everything else is the same object, so
 * a merchant reading a product in the dashboard and an SDK reading it over the
 * payment API are reading the same thing.
 */

import type { PaymentLink, Product } from "@mayarin/catalog";
import { isLinkPayable, PAYMENT_LINK_KINDS } from "@mayarin/catalog";
import { CHAIN_IDS } from "@mayarin/chain";
import { assetCodeSchema, decimalMoneySchema, timestampSchema } from "@mayarin/shared";
import { z } from "zod";
import { toMoneyDto } from "./money.ts";

const metadataSchema = z.record(z.string(), z.string()).optional();
const linkRailsSchema = z
  .array(z.object({ chain: z.enum(CHAIN_IDS), asset: assetCodeSchema }).strict())
  .min(1);

export const createProductBodySchema = z
  .object({
    sku: z.string().min(1).max(64),
    name: z.string().min(1).max(255),
    description: z.string().max(2_000).optional(),
    /** One entry per currency the merchant prices in. At least one. */
    prices: z.array(decimalMoneySchema).min(1),
    metadata: metadataSchema,
  })
  .strict();

export const updateProductBodySchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    /** `null` clears it; an absent field leaves it alone. */
    description: z.string().max(2_000).nullable().optional(),
    prices: z.array(decimalMoneySchema).min(1).optional(),
    active: z.boolean().optional(),
    metadata: metadataSchema,
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one field must be supplied",
  });

export const listProductsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().min(1).optional(),
  active: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

export const createLinkBodySchema = z
  .object({
    kind: z.enum(PAYMENT_LINK_KINDS),
    /** `fixed` only. */
    amount: decimalMoneySchema.optional(),
    /** `open` and `catalog`. */
    currency: assetCodeSchema.optional(),
    /** `catalog` only. */
    lines: z
      .array(
        z.object({
          productId: z.string().min(1),
          quantity: z.number().int().positive(),
        }),
      )
      .min(1)
      .optional(),
    title: z.string().min(1).max(255).optional(),
    merchantReference: z.string().min(1).max(255).optional(),
    /** A customer every intent minted from this link is taken for, stamped as `metadata.customerId`. */
    customerId: z.string().min(1).optional(),
    metadata: metadataSchema,
    expiresAt: timestampSchema.optional(),
    /** Rails this link may be paid on (#259). At least one when restricted. */
    rails: linkRailsSchema.optional(),
  })
  // The per-kind shape is enforced by `createPaymentLink`, which is where the
  // rule belongs — a second copy here would be a second copy to get wrong.
  .strict();

export const updateLinkBodySchema = z.object({ rails: linkRailsSchema }).strict();

type CreateLinkBody = z.infer<typeof createLinkBodySchema>;

/**
 * Drops absent fields rather than passing them through as `undefined`.
 *
 * `exactOptionalPropertyTypes` distinguishes "no title" from "title is
 * undefined", and Zod's inferred type allows the second.
 */
export function toCreateLinkInput(body: CreateLinkBody) {
  return {
    kind: body.kind,
    ...(body.amount === undefined ? {} : { amount: body.amount }),
    ...(body.currency === undefined ? {} : { currency: body.currency }),
    ...(body.lines === undefined ? {} : { lines: body.lines }),
    ...(body.title === undefined ? {} : { title: body.title }),
    ...(body.merchantReference === undefined ? {} : { merchantReference: body.merchantReference }),
    ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt }),
    ...(body.rails === undefined ? {} : { rails: body.rails }),
  };
}

export function toProductDto(product: Product) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description ?? null,
    prices: product.prices.map(toMoneyDto),
    active: product.active,
    metadata: product.metadata,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    version: product.version,
  };
}

/**
 * A link on the wire.
 *
 * `url` is what a merchant shares and what a printed QR encodes — the whole
 * point of the object, and it points at the payment API, not at the dashboard.
 * Served rather than assembled client-side, because the browser would otherwise
 * have to be told the checkout origin separately and would get it wrong in
 * exactly the deployment where the two are not on the same host.
 */
export function toPaymentLinkDto(
  link: PaymentLink,
  checkoutBaseUrl: string,
  now: Date,
  priceable = true,
) {
  return {
    id: link.id,
    kind: link.kind,
    amount: link.amount === undefined ? null : toMoneyDto(link.amount),
    currency: link.currency ?? null,
    lines: link.lines ?? null,
    title: link.title ?? null,
    merchantReference: link.merchantReference ?? null,
    metadata: link.metadata,
    /** `null` means the link inherits every rail the merchant can offer. */
    rails: link.rails ?? null,
    url: `${checkoutBaseUrl}/checkout/${link.id}`,
    payable: isLinkPayable(link, now) && priceable,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    disabledAt: link.disabledAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    version: link.version,
  };
}
