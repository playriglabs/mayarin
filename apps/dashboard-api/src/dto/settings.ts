/**
 * Merchant settings request schemas and response DTOs (#95).
 *
 * The patch body deliberately has no `merchantId`: the merchant being edited is
 * the one on the session, and a field that cannot be sent cannot be forged.
 */

import type { Merchant, MerchantSettingChange } from "@mayarin/auth";
import { assetCodeSchema } from "@mayarin/shared";
import { z } from "zod";

export const updateSettingsBodySchema = z
  .object({
    settlementAsset: assetCodeSchema.optional(),
    acceptedAssets: z.array(assetCodeSchema).max(32).optional(),
    /**
     * `null` clears the address, an absent field leaves it alone. Two different
     * requests, and a merchant making the first should not be told they made
     * the second.
     */
    settlementAddress: z.string().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one setting must be supplied",
  });

export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export function toSettingsDto(merchant: Merchant) {
  return {
    merchantId: merchant.id,
    name: merchant.name,
    settlementAsset: merchant.settlementAsset,
    acceptedAssets: merchant.acceptedAssets,
    settlementAddress: merchant.settlementAddress ?? null,
    /**
     * Whether this merchant can take a contract-path payment at all. Derived
     * rather than stored: `PRICE_LOCKED` refuses to sign without an address, so
     * a merchant should be able to see that before a payment fails rather than
     * after.
     */
    canSettleOnChain: merchant.settlementAddress !== undefined,
    updatedAt: merchant.updatedAt.toISOString(),
  };
}

export function toSettingChangeDto(change: MerchantSettingChange) {
  return {
    id: change.id,
    field: change.field,
    previousValue: change.previousValue ?? null,
    nextValue: change.nextValue ?? null,
    changedBy: change.userId,
    changedAt: change.changedAt.toISOString(),
  };
}
