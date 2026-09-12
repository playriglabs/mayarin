/**
 * Where a human goes to check a transaction or an address.
 *
 * A chain fact, like `CHAIN_LABELS` and for the same reason: the explorer for
 * a chain is the same everywhere Mayarin runs, and a second copy of this table
 * is how a hash ends up linking to the wrong network.
 */
import type { ChainId } from "./types.ts";

const EXPLORERS = {
  "ethereum-sepolia": "https://sepolia.etherscan.io/",
  base: "https://basescan.org/",
  "base-sepolia": "https://sepolia.basescan.org/",
  arbitrum: "https://arbiscan.io/",
  "arbitrum-sepolia": "https://sepolia.arbiscan.io/",
  "robinhood-testnet": "https://explorer.testnet.chain.robinhood.com/",
  "arc-testnet": "https://testnet.arcscan.app/",
} as const satisfies Readonly<Record<ChainId, string>>;

type ExplorerChain = keyof typeof EXPLORERS;

function isExplorerChain(chain: string): chain is ExplorerChain {
  return chain in EXPLORERS;
}

const TX_HASH = /^0x[\da-f]{64}$/i;
const ADDRESS = /^0x[\da-f]{40}$/i;

/** Returns no link for internal references, malformed hashes, or unsupported chains. */
export function transactionExplorerUrl(chain: string, transactionHash: string): string | undefined {
  if (!isExplorerChain(chain) || !TX_HASH.test(transactionHash)) return undefined;
  return `${EXPLORERS[chain]}tx/${transactionHash}`;
}

/**
 * The deposit address's page — where a merchant watches the payer's transfer
 * land. Returns no link for malformed addresses or unsupported chains.
 */
export function addressExplorerUrl(chain: string, address: string): string | undefined {
  if (!isExplorerChain(chain) || !ADDRESS.test(address)) return undefined;
  return `${EXPLORERS[chain]}address/${address}`;
}

/**
 * A hash shortened for display. The full value belongs in a `title`.
 *
 * Here rather than in each component because three of them were shortening
 * hashes and two had already written this function.
 */
export function shortHash(hash: string): string {
  return hash.length <= 20 ? hash : `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}
