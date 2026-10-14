/**
 * Merchant settings request schemas and response DTOs (#95).
 *
 * The patch body deliberately has no `merchantId`: the merchant being edited is
 * the one on the session, and a field that cannot be sent cannot be forged.
 */

import type { Merchant, MerchantSettingChange, User } from "@mayarin/auth";
import { CHAIN_IDS } from "@mayarin/chain";
import { assetCodeSchema } from "@mayarin/shared";
import { z } from "zod";

export const updateSettingsBodySchema = z
  .object({
    settlementAsset: assetCodeSchema.optional(),
    /**
     * Settlement asset overridden per chain, sent as a whole map. A chain
     * absent settles in `settlementAsset`.
     */
    settlementAssetByChain: z.record(z.enum(CHAIN_IDS), assetCodeSchema).optional(),
    acceptedAssets: z.array(assetCodeSchema).max(32).optional(),
    /**
     * Accepted payer assets narrowed per chain (#244).
     *
     * Sent as a whole map, because the settings screen edits the matrix as one
     * thing and a per-chain merge would leave a merchant no way to remove a
     * chain's row at all. A chain absent inherits `acceptedAssets`; a chain
     * present with an empty list is stored as absent, so "inherit" keeps one
     * representation.
     */
    acceptedAssetsByChain: z.record(z.enum(CHAIN_IDS), z.array(assetCodeSchema).max(32)).optional(),
    /**
     * `null` clears the address, an absent field leaves it alone. Two different
     * requests, and a merchant making the first should not be told they made
     * the second.
     *
     * The shape is checked *here* rather than only in the domain because the
     * route probes every chain for contract code before the domain ever sees
     * the value. An unparseable address made that probe fail at the RPC, and a
     * merchant who typed one character got "A connected service could not
     * complete this request" — a provider fault for what is plainly their typo.
     * Checksum case is deliberately not enforced: EIP-55 is a hint, and an
     * all-lowercase address copied from an explorer is correct.
     */
    settlementAddress: z
      .union([
        // An emptied text field is a merchant saying "pay me at the managed
        // wallet", which is the same request as `null` — so it lands on the
        // clear path rather than being told a blank box is a malformed
        // address. Listed first so it never reaches the pattern below.
        z.literal("").transform(() => null),
        z
          .string()
          .regex(
            /^(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/,
            "A settlement address must be an EVM address or Solana public key",
          ),
        z.null(),
      ])
      .optional(),
    /**
     * Buyer protection (#304): hold a payer's payment in escrow when they pay
     * from a connected wallet. `null` turns it off. `arbiter` replaces Mayarin
     * Resolution; it cannot be the merchant's own settlement address.
     */
    buyerProtection: z
      .object({
        holdSeconds: z.number().int(),
        arbiter: z
          .string()
          .regex(/^0x[0-9a-fA-F]{40}$/, "An arbiter must be a 20-byte hex address")
          .optional(),
        /** The dispute bond (#315), basis points of the payment, 0–2000. */
        bondBps: z.number().int().min(0).max(2_000).optional(),
      })
      .strict()
      .nullable()
      .optional(),
    /**
     * Merchant profile (#15). Frozen into the snapshot every payment link and
     * intent carries, so it is edited here and nowhere a buyer can reach.
     */
    city: z.string().nullable().optional(),
    countryCode: z.string().nullable().optional(),
    /**
     * The chain a payment funded in a local currency is delivered to. `null`
     * goes back to the deployment's rule, an absent field leaves it alone.
     */
    localCurrencyChain: z.enum(CHAIN_IDS).nullable().optional(),
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
 *
 * `owner` is the account that registered the merchant — its first user.
 */
export function toSettingsDto(
  merchant: Merchant,
  effectiveSettlementAddress: string | undefined,
  owner: User | undefined,
) {
  return {
    merchantId: merchant.id,
    name: merchant.name,
    /** #1, #2, … in sign-up order. */
    registrationNumber: merchant.registrationNumber ?? null,
    registeredAt: merchant.createdAt.toISOString(),
    logoUrl: merchant.logoUrl ?? null,
    createdBy:
      owner === undefined
        ? null
        : { email: owner.email, emailVerified: owner.emailVerifiedAt !== undefined },
    settlementAsset: merchant.settlementAsset,
    /** Per-chain override. A chain absent here settles in `settlementAsset`. */
    settlementAssetByChain: merchant.settlementAssetByChain ?? {},
    acceptedAssets: merchant.acceptedAssets,
    /** Per-chain narrowing (#244). A chain absent here inherits `acceptedAssets`. */
    acceptedAssetsByChain: merchant.acceptedAssetsByChain ?? {},
    /** What the merchant chose. `null` is "not chosen", not "nowhere to pay". */
    settlementAddress: merchant.settlementAddress ?? null,
    /** Buyer protection (#304); `null` is off. */
    buyerProtection: merchant.buyerProtection ?? null,
    city: merchant.city ?? null,
    countryCode: merchant.countryCode ?? null,
    /** Where a local-currency payment is delivered. `null` is the deployment's rule. */
    localCurrencyChain: merchant.localCurrencyChain ?? null,
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
