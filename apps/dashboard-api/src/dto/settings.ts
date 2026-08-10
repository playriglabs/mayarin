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
    /**
     * Merchant profile (#15). Frozen into the snapshot every payment link and
     * intent carries, so it is edited here and nowhere a buyer can reach.
     */
    city: z.string().nullable().optional(),
    countryCode: z.string().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one setting must be supplied",
  });

export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/**
 * `effectiveSettlementAddress` is where the money actually goes: what the
 * merchant set, or their managed wallet when they set nothing (#11). Passed in
 * rather than derived here, because the rule belongs to
 * `SettlementAddressResolver` and a second copy of it in a DTO is a second copy
 * to get wrong.
 *
 * `undefined` means neither exists, and then a contract-path payment cannot be
 * signed at all.
 */
export function toSettingsDto(merchant: Merchant, effectiveSettlementAddress?: string) {
  return {
    merchantId: merchant.id,
    name: merchant.name,
    settlementAsset: merchant.settlementAsset,
    acceptedAssets: merchant.acceptedAssets,
    /** What the merchant chose. `null` is "not chosen", not "nowhere to pay". */
    settlementAddress: merchant.settlementAddress ?? null,
    city: merchant.city ?? null,
    countryCode: merchant.countryCode ?? null,
    /**
     * Whether this merchant can mint a payment link yet. A link freezes a
     * merchant snapshot, and the snapshot needs both profile fields — so the
     * dashboard can say which one is missing instead of failing at the button.
     */
    canCreateLinks: merchant.city !== undefined && merchant.countryCode !== undefined,
    effectiveSettlementAddress: effectiveSettlementAddress ?? null,
    /**
     * Whether this merchant can take a contract-path payment at all. Derived
     * rather than stored: `PRICE_LOCKED` refuses to sign without an address, so
     * a merchant should be able to see that before a payment fails rather than
     * after.
     *
     * Reads the effective address, not the configured one — a merchant paid at
     * their provisioned Safe has chosen nothing and can settle perfectly well.
     */
    canSettleOnChain: effectiveSettlementAddress !== undefined,
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
