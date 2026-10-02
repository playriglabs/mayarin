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

import type { ChainId } from "@mayarin/chain";
import type { AssetCode } from "@mayarin/shared";
import type { EscrowRequest } from "./types.ts";

/** What one merchant will be paid in, and what they will take payment in. */
export interface MerchantAssetPolicy {
  /** The asset the merchant is paid in on every chain without an override. */
  readonly settlementAsset: AssetCode;
  /**
   * The settlement asset overridden per chain. A chain absent settles in
   * `settlementAsset`. Read it through `settlementAssetOnChain`.
   */
  readonly settlementAssetByChain?: Readonly<Partial<Record<ChainId, AssetCode>>>;
  /**
   * Assets a payer may pay with. Empty means the merchant has expressed no
   * preference and the deployment default stands.
   */
  readonly acceptedAssets: readonly AssetCode[];
  /**
   * The same choice narrowed per chain (#244), for a deployment that takes
   * payment on more than one.
   *
   * A chain absent inherits `acceptedAssets`; a chain present carries its own
   * non-empty list. Read it through `acceptedPayerAssets` rather than indexing
   * it, so the inheritance rule lives in one place.
   */
  readonly acceptedAssetsByChain?: Readonly<Partial<Record<ChainId, readonly AssetCode[]>>>;
  /**
   * Where the merchant is paid on-chain — the signed order's `merchantSafe`.
   *
   * Absent for a merchant who settles off-chain only. The contract path refuses
   * to lock without it rather than falling back to a deployment-wide address,
   * which would pay every merchant into the same wallet.
   */
  readonly settlementAddress?: string;
  /**
   * Buyer protection (#304): the escrow a payer who connects a wallet gets by
   * default. Absent: off.
   */
  readonly buyerProtection?: EscrowRequest;
}

/** Reads one merchant's asset policy. */
export interface MerchantAssetPolicySource {
  /** The policy for a merchant, or `undefined` when the merchant has none. */
  policyFor(merchantId: string): Promise<MerchantAssetPolicy | undefined>;
}

/**
 * What a payer may send this merchant on one chain.
 *
 * Empty means the merchant expressed no preference, which the rail catalog
 * reads as "whatever this chain can receive" — never as "nothing".
 */
export function acceptedPayerAssets(
  policy: MerchantAssetPolicy,
  chain: ChainId,
): readonly AssetCode[] {
  const perChain = policy.acceptedAssetsByChain?.[chain];
  const accepted = perChain !== undefined && perChain.length > 0 ? perChain : policy.acceptedAssets;
  // A chain's own settlement asset is always accepted there: the inherited
  // merchant-wide list only ever carried the default one.
  const override = policy.settlementAssetByChain?.[chain];
  return override === undefined || accepted.length === 0 || accepted.includes(override)
    ? accepted
    : [override, ...accepted];
}

/** What the merchant is paid in on one chain: the override, or the merchant-wide asset. */
export function settlementAssetOnChain(policy: MerchantAssetPolicy, chain: ChainId): AssetCode {
  return policy.settlementAssetByChain?.[chain] ?? policy.settlementAsset;
}

/** True when the payer sends exactly what the merchant settles in on that chain — no swap. */
export function isSameAsset(
  policy: MerchantAssetPolicy,
  payerAsset: AssetCode,
  chain: ChainId,
): boolean {
  return settlementAssetOnChain(policy, chain) === payerAsset;
}
