/** Reads the operator key's transactions off each chain's RPC (SEC-04). */

import { isChainId } from "@mayarin/chain";
import type { OperatorChainReader } from "@mayarin/shared";
import { type Address, createPublicClient, type Hex, http, type PublicClient } from "viem";

export function rpcOperatorChainReader(
  rpcUrls: Readonly<Partial<Record<string, string>>>,
): OperatorChainReader {
  const clients = new Map<string, PublicClient>();

  // The sequencer's key is `${chain}:${address}`; chain names contain no colon.
  const parse = (key: string): { chain: string; address: Address; client: PublicClient } => {
    const split = key.indexOf(":");
    const chain = key.slice(0, split);
    const rpcUrl = isChainId(chain) ? rpcUrls[chain] : undefined;
    if (rpcUrl === undefined) throw new Error(`No RPC URL configured for ${chain}`);
    let client = clients.get(chain);
    if (client === undefined) {
      client = createPublicClient({ transport: http(rpcUrl) });
      clients.set(chain, client);
    }
    return { chain, address: key.slice(split + 1) as Address, client };
  };

  return {
    async confirmedNonce(key) {
      const { address, client } = parse(key);
      return client.getTransactionCount({ address, blockTag: "latest" });
    },
    async receipt(key, hash) {
      const { client } = parse(key);
      try {
        const receipt = await client.getTransactionReceipt({ hash: hash as Hex });
        return receipt.status === "success" ? "success" : "reverted";
      } catch (error) {
        // viem throws when the node has no receipt yet; anything else is a real failure.
        if (error instanceof Error && error.name === "TransactionReceiptNotFoundError") {
          return undefined;
        }
        throw error;
      }
    },
  };
}
