/**
 * What a stablecoin's minor unit is on a chain.
 *
 * `assetDecimals` is one number per asset, and the quote, the ledger and the
 * signed order all count in it. A token on another chain may not agree: USDT and
 * USDC on BNB Smart Chain carry 18 decimals where everywhere else they carry 6.
 * The domain keeps counting in the asset's own units; these three functions are
 * the only place that crosses to what a token contract says, so a BSC payment
 * cannot be off by 10^12 anywhere but here.
 */

import { type AssetCode, assetDecimals, getAsset } from "@mayarin/shared";
import type { ChainId } from "./types.ts";

/** Decimals every stablecoin carries on a chain that differs from the registry. */
const STABLECOIN_DECIMALS: Readonly<Partial<Record<ChainId, number>>> = {
  "bsc-testnet": 18,
};

/** How many on-chain minor units one domain minor unit is. `1n` when they agree. */
export function chainUnitScale(chain: ChainId, asset: AssetCode): bigint {
  const onChain = STABLECOIN_DECIMALS[chain];
  if (onChain === undefined || getAsset(asset).kind !== "stablecoin") return 1n;
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

/**
 * For a record that names no asset, such as a settlement log or an order being
 * renewed. Every settlement asset is a stablecoin and all stablecoins share one
 * scale on a chain, so any one of them stands for the rest.
 */
export function toSettlementUnits(chain: ChainId, amount: bigint): bigint {
  return toChainUnits(chain, "USDC", amount);
}

export function fromSettlementUnits(chain: ChainId, amount: bigint): bigint {
  return fromChainUnits(chain, "USDC", amount);
}
