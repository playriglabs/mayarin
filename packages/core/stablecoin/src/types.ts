/**
 * Stablecoin registry types.
 *
 * The registry is a catalog of which stablecoins a deployment admits and where
 * each lives on-chain. It answers _what is admissible_, never _what it costs_
 * (the Liquidity Router) or _how it pays_ (the Settlement Engine). A deposit is
 * still an observation, not a posting — the registry touches no ledger account.
 */

import type { ChainId } from "@mayarin/chain";
import type { AssetCode } from "@mayarin/shared";

/** An ERC-20 identity of a stablecoin on one chain. */
export interface StablecoinOnChain {
  readonly chain: ChainId;
  /** Lowercase `0x`-prefixed contract address. */
  readonly address: `0x${string}`;
}

/**
 * A stablecoin this deployment admits.
 *
 * `onChain` is empty for a ledger-only settlement asset — one a deployment
 * credits internally but never holds on-chain, so it can settle a payment but
 * cannot be the payer's leg.
 */
export interface Stablecoin {
  readonly asset: AssetCode;
  /** Where this stablecoin lives on-chain. Empty for ledger-only assets. */
  readonly onChain: readonly StablecoinOnChain[];
}

/** True when a stablecoin has no on-chain identity — settle-only, never a payer leg. */
export function isLedgerOnly(stablecoin: Stablecoin): boolean {
  return stablecoin.onChain.length === 0;
}

/** A `(chain, asset)` pair the watcher must observe — one per on-chain identity. */
export interface StablecoinPair {
  readonly chain: ChainId;
  readonly asset: AssetCode;
}

/** Flattens every on-chain identity into the pairs the watcher ticks over. */
export function pairsOf(stablecoins: readonly Stablecoin[]): StablecoinPair[] {
  const pairs: StablecoinPair[] = [];
  for (const coin of stablecoins) {
    for (const entry of coin.onChain) {
      pairs.push({ chain: entry.chain, asset: coin.asset });
    }
  }
  return pairs;
}

/**
 * The single source of truth for admissible stablecoins.
 *
 * Implemented in-memory from config; no I/O, no persistence. The port keeps it
 * swappable — a future registry backed by an on-chain factory or a catalog
 * service implements the same surface without touching its callers.
 */
export interface StablecoinRegistry {
  /** Every admitted stablecoin. */
  list(): Promise<readonly Stablecoin[]>;
  /** The stablecoin for an asset, or undefined if not admitted. */
  find(asset: AssetCode): Promise<Stablecoin | undefined>;
  /** True if the asset is registered (admissible as a settlement asset). */
  isSettlementAsset(asset: AssetCode): Promise<boolean>;
  /** True if the asset is registered and deployed on the chain (a deposit asset). */
  isDepositAsset(asset: AssetCode, chain: ChainId): Promise<boolean>;
  /** The contract address for an asset on a chain, or undefined if not deployed there. */
  address(asset: AssetCode, chain: ChainId): Promise<`0x${string}` | undefined>;
}
