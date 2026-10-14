/**
 * The viem `Chain` for each `ChainId`, in one place.
 *
 * Every viem-backed provider needs the same mapping, and the map is exhaustive
 * over `ChainId` on purpose: widening `CHAIN_IDS` should fail to compile until
 * the new chain has a definition, rather than fail at runtime on the first RPC
 * call. Keeping one copy is also what stops a chain from being defined slightly
 * differently in two adapters.
 *
 * This package holds nothing but chain facts so that a price adapter can import
 * it without pulling in a signer's dependency tree.
 */

import { type ChainId, type EvmChainId, isEvmChainId } from "@mayarin/chain";
import type { Chain } from "viem";
import {
  arbitrum,
  arbitrumSepolia,
  arcTestnet,
  base,
  baseSepolia,
  bscTestnet,
  polygonAmoy,
  sepolia,
} from "viem/chains";

// Typed as the generic `Chain` rather than a union of the concrete chains so
// clients built from this map share one type: the op-stack chains specialise
// their block's `transactions` to include deposit transactions, which is
// unrelated to the generic client's block type and would otherwise force a cast
// at every call site.
export const VIEM_CHAINS: Readonly<Record<EvmChainId, Chain>> = {
  "ethereum-sepolia": sepolia,
  base,
  "base-sepolia": baseSepolia,
  arbitrum,
  "arbitrum-sepolia": arbitrumSepolia,
  "arc-testnet": arcTestnet,
  "polygon-amoy": polygonAmoy,
  "bsc-testnet": bscTestnet,
};

export function viemChainOf(chain: ChainId): Chain {
  if (!isEvmChainId(chain)) throw new Error(`${chain} is not an EVM chain`);
  return VIEM_CHAINS[chain];
}
