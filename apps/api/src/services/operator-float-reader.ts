/** Reads the operator's balances off each chain's RPC (SEC-06). */

import { isChainId } from "@mayarin/chain";
import { type AssetCode, ConfigurationError, type FloatReader } from "@mayarin/shared";
import { type Address, createPublicClient, erc20Abi, http, type PublicClient } from "viem";

export interface OperatorFloatReaderOptions {
  readonly address: Address;
  readonly rpcUrls: Readonly<Partial<Record<string, string>>>;
  /** The chain's own currency, read as a balance rather than a token. */
  readonly nativeAssets: Readonly<Partial<Record<string, AssetCode>>>;
  /** Token contract per chain and asset. */
  readonly tokens: Readonly<Partial<Record<string, Partial<Record<string, string>>>>>;
}

export function rpcFloatReader(options: OperatorFloatReaderOptions): FloatReader {
  const clients = new Map<string, PublicClient>();
  const clientFor = (chain: string): PublicClient => {
    const rpcUrl = isChainId(chain) ? options.rpcUrls[chain] : undefined;
    if (rpcUrl === undefined)
      throw new ConfigurationError(`No RPC URL configured for ${chain}`, {});
    let client = clients.get(chain);
    if (client === undefined) {
      client = createPublicClient({ transport: http(rpcUrl) });
      clients.set(chain, client);
    }
    return client;
  };

  return {
    async balance(chain, asset) {
      const client = clientFor(chain);
      if (options.nativeAssets[chain] === asset) {
        return client.getBalance({ address: options.address });
      }
      const token = options.tokens[chain]?.[asset];
      if (token === undefined) {
        throw new ConfigurationError(`No token address for ${asset} on ${chain}`, { chain, asset });
      }
      return client.readContract({
        address: token as Address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [options.address],
      });
    },
  };
}
