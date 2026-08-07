/**
 * Per-merchant asset policy.
 *
 * Which asset a merchant is paid in, and which assets they let a payer pay
 * with, are the merchant's decisions — not the deployment's. This port is how
 * the intent service reads them without depending on the merchant record's
 * storage or on `@mayarin/auth`.
 *
 * The two are independent, and the interesting case is where they meet: a payer
 * paying the merchant's own settlement asset settles with **no swap at all**,
 * while any other accepted asset is swapped on the way in. That is a property of
 * the pair, not of the asset — USDT into a USDC merchant is two stablecoins and
 * still a swap.
 */

import type { AssetCode } from "@mayarin/shared";

/** What one merchant will be paid in, and what they will take payment in. */
export interface MerchantAssetPolicy {
  /** The single asset the merchant is paid in. */
  readonly settlementAsset: AssetCode;
  /**
   * Assets a payer may pay with. Empty means the merchant has expressed no
   * preference and the deployment default stands.
   */
  readonly acceptedAssets: readonly AssetCode[];
}

/** Reads one merchant's asset policy. */
export interface MerchantAssetPolicySource {
  /** The policy for a merchant, or `undefined` when the merchant has none. */
  policyFor(merchantId: string): Promise<MerchantAssetPolicy | undefined>;
}

/** True when the payer sends exactly what the merchant settles in — no swap. */
export function isSameAsset(policy: MerchantAssetPolicy, payerAsset: AssetCode): boolean {
  return policy.settlementAsset === payerAsset;
}
