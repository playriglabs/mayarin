/**
 * Payment intent request schemas and response DTO.
 *
 * Request validation lives with the DTO it produces, so "an intent on the wire"
 * means one thing in every route that touches it.
 */

import { CHAIN_IDS } from "@mayarin/chain";
import {
  type EscrowRequest,
  EXECUTION_PATHS,
  type ExecutionPath,
  type MerchantSnapshot,
  type PaymentIntent,
  type PaymentIntentStatus,
  type PaymentRail,
  type PaymentSource,
} from "@mayarin/payment-intent";
import { type AssetCode, assetCodeSchema, decimalMoneySchema } from "@mayarin/shared";
import { z } from "zod";
import { type MoneyDto, toMoneyDto } from "./money.ts";

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

/** The rail the payer intends to pay on, e.g. USDC on Base. */
export const paymentRailSchema = z
  .object({
    asset: assetCodeSchema,
    chain: z.enum(CHAIN_IDS),
    /** Required by the on-chain-contract path: the signed order's `refundTo`. */
    payerAddress: z
      .string()
      .regex(/^(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/)
      .optional(),
  })
  // `exactOptionalPropertyTypes`: the rail's optional field must be absent,
  // never an explicit `undefined`.
  .transform(({ asset, chain, payerAddress }) => ({
    asset,
    chain,
    ...(payerAddress === undefined ? {} : { payerAddress }),
  }));

/**
 * The optional body of `POST /payment-intents/:id/confirm`.
 *
 * Empty for an intent that already has its rail. An intent minted without one —
 * a storefront's cart checkout — takes the payer's choice here, from the hosted
 * payment page, in the same request that confirms it.
 */
export const confirmBodySchema = z.object({
  payment: paymentRailSchema.optional(),
  executionPath: z.enum(EXECUTION_PATHS).optional(),
});

export const createBodySchema = z
  .object({
    /** Raw EMVCo/QRIS payload as scanned. */
    qr: z.string().min(1).optional(),
    merchant: merchantSchema.optional(),
    /** Human decimal amount, e.g. `{ "amount": "50000.00", "asset": "IDR" }`. */
    amount: decimalMoneySchema.optional(),
    payment: paymentRailSchema.optional(),
    settlementAsset: assetCodeSchema.optional(),
    /**
     * How the `payment` rail is executed, chosen per payer rather than per
     * deployment: a marketplace checkout where the payer connects a wallet
     * takes `on-chain-contract`, while a payer who scans or pastes an address
     * can only take `deposit-match`. Omitted, the deployment default stands.
     */
    executionPath: z.enum(EXECUTION_PATHS).optional(),
    /**
     * Conditional settlement (#304): settle into escrow, releasable by the payer
     * at once or by anyone after `holdSeconds` (1–90 days) unless disputed. Needs
     * the payer's wallet on the rail; not on x402. Omitted: the merchant's buyer
     * protection applies when the payer connects a wallet. `null`: never.
     */
    escrow: z
      .object({
        holdSeconds: z.number().int().positive(),
        arbiter: z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/)
          .optional(),
        /** The dispute bond (#315), basis points of what reaches the escrow, 0–2000. */
        bondBps: z.number().int().min(0).max(2_000).optional(),
      })
      // `null` opts this payment out of the merchant's buyer protection.
      .nullable()
      .optional(),
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
export type CreatePaymentIntentBody = z.input<typeof createBodySchema>;

export interface PaymentIntentDto {
  readonly id: string;
  readonly status: PaymentIntentStatus;
  readonly merchant: MerchantSnapshot;
  readonly amount: MoneyDto;
  readonly settlementAsset: AssetCode;
  readonly provider: string;
  readonly payment: PaymentRail | null;
  readonly executionPath: ExecutionPath | null;
  readonly escrow: EscrowRequest | null;
  readonly source: PaymentSource;
  readonly metadata: Readonly<Record<string, string>>;
  readonly merchantReference: string | null;
  readonly clearingTransactionId: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly confirmedAt: string | null;
  readonly completedAt: string | null;
}

export function toPaymentIntentDto(intent: PaymentIntent): PaymentIntentDto {
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
    /** The escrow this payment settles into (#304); `null` for an ordinary payment. */
    escrow: intent.escrow ?? null,
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
