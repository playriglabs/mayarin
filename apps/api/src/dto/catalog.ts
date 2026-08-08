/**
 * Commerce request schemas and response DTOs.
 *
 * Request validation lives with the DTO it produces, so "a product" and "a
 * payment link" mean one thing in every route that touches them.
 */

import type { PaymentLink, Product } from "@mayarin/catalog";
import { isLinkPayable, PAYMENT_LINK_KINDS } from "@mayarin/catalog";
import { CHAIN_IDS } from "@mayarin/chain";
import { EXECUTION_PATHS } from "@mayarin/payment-intent";
import { assetCodeSchema, decimalMoneySchema, timestampSchema } from "@mayarin/shared";
import { z } from "zod";
import { toMoneyDto } from "./money.ts";
import { merchantSchema } from "./payment-intent.ts";

const metadataSchema = z.record(z.string(), z.string()).optional();
const merchantReferenceSchema = z.string().min(1).max(255).optional();

export const createProductBodySchema = z.object({
  merchantId: z.string().min(1),
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  description: z.string().max(2_000).optional(),
  /** One entry per currency the merchant prices in. At least one. */
  prices: z.array(decimalMoneySchema).min(1),
  metadata: metadataSchema,
});

export const updateProductBodySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2_000).optional(),
  prices: z.array(decimalMoneySchema).min(1).optional(),
  active: z.boolean().optional(),
  metadata: metadataSchema,
});

/** The intent-shaping options every checkout accepts, whatever it is checking out. */
const intentOptionsSchema = z.object({
  settlementAsset: assetCodeSchema.optional(),
  provider: z.string().min(1).optional(),
  payment: z
    .object({
      asset: assetCodeSchema,
      chain: z.enum(CHAIN_IDS),
      payerAddress: z
        .string()
        .regex(/^0x[0-9a-fA-F]{40}$/)
        .optional(),
    })
    // `exactOptionalPropertyTypes`: the rail's optional field must be absent,
    // never an explicit `undefined`.
    .transform(({ asset, chain, payerAddress }) => ({
      asset,
      chain,
      ...(payerAddress === undefined ? {} : { payerAddress }),
    }))
    .optional(),
  executionPath: z.enum(EXECUTION_PATHS).optional(),
  metadata: metadataSchema,
  merchantReference: merchantReferenceSchema,
  ttlSeconds: z.number().int().positive().optional(),
});

const cartLineSchema = z.union([
  z.object({
    productId: z.string().min(1),
    quantity: z.number().int().positive(),
  }),
  z.object({
    /** An ad-hoc line a cashier typed in — no catalog row behind it. */
    name: z.string().min(1).max(255),
    unitPrice: decimalMoneySchema,
    quantity: z.number().int().positive(),
  }),
]);

export const checkoutCartBodySchema = intentOptionsSchema.extend({
  merchant: merchantSchema,
  currency: assetCodeSchema,
  lines: z.array(cartLineSchema).min(1),
});

export const createPaymentLinkBodySchema = z
  .object({
    kind: z.enum(PAYMENT_LINK_KINDS),
    merchant: merchantSchema,
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
    merchantReference: merchantReferenceSchema,
    metadata: metadataSchema,
    expiresAt: timestampSchema.optional(),
  })
  // The per-kind shape is enforced by `createPaymentLink`, which is where the
  // rule belongs — the route would otherwise carry a second copy that can drift.
  .strict();

export const checkoutLinkBodySchema = intentOptionsSchema.extend({
  /** Required by an `open` link, refused by the others. */
  amount: decimalMoneySchema.optional(),
});

type IntentOptionsBody = z.infer<typeof intentOptionsSchema>;

/**
 * Drops absent options rather than passing them through as `undefined`.
 *
 * `exactOptionalPropertyTypes` distinguishes "no metadata" from "metadata is
 * undefined", and Zod's inferred type allows the second. Rebuilding the object
 * once here keeps that spread out of every route.
 */
export function toIntentOptions(body: IntentOptionsBody) {
  return {
    ...(body.settlementAsset === undefined ? {} : { settlementAsset: body.settlementAsset }),
    ...(body.provider === undefined ? {} : { provider: body.provider }),
    ...(body.payment === undefined ? {} : { payment: body.payment }),
    ...(body.executionPath === undefined ? {} : { executionPath: body.executionPath }),
    ...(body.metadata === undefined ? {} : { metadata: body.metadata }),
    ...(body.merchantReference === undefined ? {} : { merchantReference: body.merchantReference }),
    ...(body.ttlSeconds === undefined ? {} : { ttlSeconds: body.ttlSeconds }),
  };
}

export function toProductDto(product: Product) {
  return {
    id: product.id,
    merchantId: product.merchantId,
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
 * point of the object, so it is served rather than left for each client to
 * assemble from a base URL they would have to be told separately.
 */
export function toPaymentLinkDto(link: PaymentLink, baseUrl: string, now: Date) {
  return {
    id: link.id,
    kind: link.kind,
    merchant: link.merchant,
    amount: link.amount === undefined ? null : toMoneyDto(link.amount),
    currency: link.currency ?? null,
    lines: link.lines ?? null,
    title: link.title ?? null,
    merchantReference: link.merchantReference ?? null,
    metadata: link.metadata,
    url: `${baseUrl}/checkout/${link.id}`,
    payable: isLinkPayable(link, now),
    expiresAt: link.expiresAt?.toISOString() ?? null,
    disabledAt: link.disabledAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
    version: link.version,
  };
}
