const TRANSACTION_EXPLORERS = {
  base: "https://basescan.org/tx/",
  "base-sepolia": "https://sepolia.basescan.org/tx/",
} as const satisfies Readonly<Record<string, string>>;

type ExplorerChain = keyof typeof TRANSACTION_EXPLORERS;

function isExplorerChain(chain: string): chain is ExplorerChain {
  return chain in TRANSACTION_EXPLORERS;
}

/** Returns no link for internal references, malformed hashes, or unsupported chains. */
export function transactionExplorerUrl(chain: string, transactionHash: string): string | undefined {
  if (!isExplorerChain(chain) || !/^0x[\da-f]{64}$/i.test(transactionHash)) return undefined;
  return `${TRANSACTION_EXPLORERS[chain]}${transactionHash}`;
}
