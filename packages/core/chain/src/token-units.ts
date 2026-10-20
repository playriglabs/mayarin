/**
 * What a stablecoin's minor unit is on a chain.
 *
 * `assetDecimals` is one number per asset, and the quote, the ledger and the
 * signed order all count in it. A token on another chain may not agree: USDT and
 * USDC on BNB Smart Chain carry 18 decimals where everywhere else they carry 6,
 * and DAI carries 18 on Ethereum and Arbitrum beside 6-decimal USDC and
 * USDT. The domain keeps counting in the asset's own units; these functions are
 * the only place that crosses to what a token contract says, so a payment cannot
 * be off by 10^12 anywhere but here.
 *
 * A scale belongs to a chain **and an asset**, because two stablecoins on one
 * chain can disagree. Every function takes the asset for that reason.
 */

import { type AssetCode, assetDecimals, getAsset } from "@mayarin/shared";
import type { ChainId } from "./types.ts";

/** Decimals every stablecoin carries on a chain that differs from the registry. */
const STABLECOIN_DECIMALS: Readonly<Partial<Record<ChainId, number>>> = {
  "bsc-testnet": 18,
  bsc: 18,
};

/**
 * Decimals of one stablecoin on a chain where its siblings disagree with it. This is
 * read back from the token contract (`decimals()`) when a token is admitted to the
 * reviewed list, and `token-units.test.ts` holds it against the list.
 */
const TOKEN_DECIMALS: Readonly<
  Partial<Record<ChainId, Readonly<Partial<Record<AssetCode, number>>>>>
> = {
  ethereum: { DAI: 18 },
  arbitrum: { DAI: 18 },
};

/** How many on-chain minor units one domain minor unit is. `1n` when they agree. */
export function chainUnitScale(chain: ChainId, asset: AssetCode): bigint {
  if (getAsset(asset).kind !== "stablecoin") return 1n;
  const onChain = TOKEN_DECIMALS[chain]?.[asset] ?? STABLECOIN_DECIMALS[chain];
  if (onChain === undefined) return 1n;
  return 10n ** BigInt(onChain - assetDecimals(asset));
}

/** A domain amount as the token contract on `chain` counts it. */
export function toChainUnits(chain: ChainId, asset: AssetCode, amount: bigint): bigint {
  return amount * chainUnitScale(chain, asset);
}

/**
 * A token contract's amount as the domain counts it. Anything finer than one
 * domain minor unit is dropped, as it is for Arc's native view.
 */
export function fromChainUnits(chain: ChainId, asset: AssetCode, amount: bigint): bigint {
  return amount / chainUnitScale(chain, asset);
}
