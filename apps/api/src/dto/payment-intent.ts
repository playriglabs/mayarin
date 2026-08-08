/**
 * Payment intent request schemas and response DTO.
 *
 * Request validation lives with the DTO it produces, so "an intent on the wire"
 * means one thing in every route that touches it.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import {
  EXECUTION_PATHS,
  type MerchantSnapshot,
  type PaymentIntent,
} from "@mayarin/payment-intent";
import { assetCodeSchema, decimalMoneySchema } from "@mayarin/shared";
import { z } from "zod";
import { toMoneyDto } from "./money.ts";

export const merchantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  city: z.string().min(1),
  countryCode: z.string().length(2),
  categoryCode: z.string().optional(),
});

/**
 * Merchant details as an exact-optional snapshot.
 *
 * `exactOptionalPropertyTypes` distinguishes "no category code" from "category
 * code is undefined", and Zod's inferred type allows the second — so the object
 * is rebuilt rather than spread.
 */
export function toMerchantSnapshot(body: z.infer<typeof merchantSchema>): MerchantSnapshot {
  const { categoryCode, ...merchant } = body;
  return { ...merchant, ...(categoryCode === undefined ? {} : { categoryCode }) };
}

export const createBodySchema = z
  .object({
    /** Raw EMVCo/QRIS payload as scanned. */
    qr: z.string().min(1).optional(),
    merchant: merchantSchema.optional(),
    /** Human decimal amount, e.g. `{ "amount": "50000.00", "asset": "IDR" }`. */
    amount: decimalMoneySchema.optional(),
    /** The rail the payer intends to pay on, e.g. USDC on Base. */
    payment: z
      .object({
        asset: assetCodeSchema,
        chain: z.enum(CHAIN_IDS),
        /** Required by the on-chain-contract path: the signed order's `refundTo`. */
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
    settlementAsset: assetCodeSchema.optional(),
    /**
     * How the `payment` rail is executed, chosen per payer rather than per
     * deployment: a marketplace checkout where the payer connects a wallet
     * takes `on-chain-contract`, while a payer who scans or pastes an address
     * can only take `deposit-match`. Omitted, the deployment default stands.
     */
    executionPath: z.enum(EXECUTION_PATHS).optional(),
    provider: z.string().min(1).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    /** The caller's own order/invoice id. Stored, indexed, never interpreted. */
    merchantReference: z.string().min(1).max(255).optional(),
    ttlSeconds: z.number().int().positive().optional(),
  })
  .refine((body) => body.qr !== undefined || body.merchant !== undefined, {
    message: "Either a QR payload or merchant details must be supplied",
  });

export type CreateBody = z.infer<typeof createBodySchema>;

export function toPaymentIntentDto(intent: PaymentIntent) {
  return {
    id: intent.id,
    status: intent.status,
    merchant: intent.merchant,
    amount: toMoneyDto(intent.amount),
    settlementAsset: intent.settlementAsset,
    provider: intent.provider,
    payment: intent.payment ?? null,
    /**
     * Which path this intent resolved to. The caller needs it back: it decides
     * whether checkout asks for `/contract-call` or renders the deposit
     * address, and the resolved value may differ from what was requested.
     * `null` for a fiat-only intent, which has no rail to execute.
     */
    executionPath: intent.executionPath ?? null,
    source: intent.source,
    metadata: intent.metadata,
    /** The merchant's own order id, echoed back untouched. */
    merchantReference: intent.merchantReference ?? null,
    clearingTransactionId: intent.clearingTransactionId ?? null,
    failureReason: intent.failureReason ?? null,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
    expiresAt: intent.expiresAt.toISOString(),
    confirmedAt: intent.confirmedAt?.toISOString() ?? null,
    completedAt: intent.completedAt?.toISOString() ?? null,
  };
}
