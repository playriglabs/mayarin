/**
 * In-memory stablecoin registry.
 *
 * Pure: built from a `Stablecoin[]` resolved by config, no I/O. Addresses are
 * EVM addresses are lowercased on construction so callers can compare without
 * normalising. Solana base58 public keys remain case-sensitive.
 */

import { type ChainId, isEvmChainId } from "@mayarin/chain";
import type { AssetCode } from "@mayarin/shared";
import type { Stablecoin, StablecoinRegistry } from "./types.ts";

export class InMemoryStablecoinRegistry implements StablecoinRegistry {
  readonly #byAsset: ReadonlyMap<AssetCode, Stablecoin>;

  constructor(stablecoins: readonly Stablecoin[]) {
    const map = new Map<AssetCode, Stablecoin>();
    for (const coin of stablecoins) {
      map.set(coin.asset, {
        asset: coin.asset,
        onChain: coin.onChain.map((entry) => ({
          chain: entry.chain,
          address: isEvmChainId(entry.chain) ? entry.address.toLowerCase() : entry.address,
        })),
      });
    }
    this.#byAsset = map;
  }

  async list(): Promise<readonly Stablecoin[]> {
    return [...this.#byAsset.values()];
  }

  async find(asset: AssetCode): Promise<Stablecoin | undefined> {
    return this.#byAsset.get(asset);
  }

  async isSettlementAsset(asset: AssetCode): Promise<boolean> {
    return this.#byAsset.has(asset);
  }

  async isDepositAsset(asset: AssetCode, chain: ChainId): Promise<boolean> {
    const coin = this.#byAsset.get(asset);
    if (coin === undefined) return false;
    return coin.onChain.some((entry) => entry.chain === chain);
  }

  async address(asset: AssetCode, chain: ChainId): Promise<string | undefined> {
    const coin = this.#byAsset.get(asset);
    if (coin === undefined) return undefined;
    return coin.onChain.find((entry) => entry.chain === chain)?.address;
  }
}
