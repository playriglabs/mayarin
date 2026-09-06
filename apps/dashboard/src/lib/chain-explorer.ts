const EXPLORERS = {
  base: "https://basescan.org/",
  "base-sepolia": "https://sepolia.basescan.org/",
  arbitrum: "https://arbiscan.io/",
  "arbitrum-sepolia": "https://sepolia.arbiscan.io/",
  "robinhood-testnet": "https://explorer.testnet.chain.robinhood.com/",
  "arc-testnet": "https://testnet.arcscan.app/",
} as const satisfies Readonly<Record<string, string>>;

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
