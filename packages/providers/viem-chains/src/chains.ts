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

import type { ChainId } from "@mayarin/chain";
import { type Chain, defineChain } from "viem";
import { arbitrum, arbitrumSepolia, arcTestnet, base, baseSepolia } from "viem/chains";

/**
 * Robinhood Chain testnet — an Arbitrum Orbit L2 with ETH as its gas token.
 * Defined here because viem ships no definition for it.
 */
export const robinhoodTestnet = defineChain({
  id: 46_630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.chain.robinhood.com/rpc"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
    },
  },
  testnet: true,
});

// Typed as the generic `Chain` rather than a union of the concrete chains so
// clients built from this map share one type: the op-stack chains specialise
// their block's `transactions` to include deposit transactions, which is
// unrelated to the generic client's block type and would otherwise force a cast
// at every call site.
export const VIEM_CHAINS: Readonly<Record<ChainId, Chain>> = {
  base,
  "base-sepolia": baseSepolia,
  arbitrum,
  "arbitrum-sepolia": arbitrumSepolia,
  "robinhood-testnet": robinhoodTestnet,
  "arc-testnet": arcTestnet,
};
