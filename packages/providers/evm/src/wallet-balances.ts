/**
 * What a merchant's payout address holds, read from the chain (#11).
 *
 * Separate from `EvmChainClient` even though both read balances: that client
 * answers the watcher's question — a balance *at a specific block*, so a reorg
 * probe can invalidate it — while this answers a merchant looking at a screen,
 * where the latest block is the only interesting one and a missing token
 * address is a configuration fact rather than a fault.
 *
 * Read-only by construction. Nothing here holds a key; moving what it reports
 * is `WalletProvider.propose`, which is a different port for that reason.
 */

import type { ChainId } from "@mayarin/chain";
import { VIEM_CHAINS } from "@mayarin/provider-viem-chains";
import { type AssetCode, type Money, money, ProviderError } from "@mayarin/shared";
import type { WalletBalanceQuery, WalletBalanceReader } from "@mayarin/wallet";
import { createPublicClient, getAddress, http, type PublicClient, parseAbi } from "viem";

const ERC20_ABI = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

export interface EvmWalletBalanceReaderOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  /** ERC-20 contract address per chain and asset. */
  readonly tokens: Readonly<Partial<Record<ChainId, Readonly<Partial<Record<AssetCode, string>>>>>>;
  /** The chain's own currency, which has no contract to call `balanceOf` on. */
  readonly nativeAssets?: Readonly<Partial<Record<ChainId, AssetCode>>>;
}

export class EvmWalletBalanceReader implements WalletBalanceReader {
  readonly #options: EvmWalletBalanceReaderOptions;
  readonly #clients = new Map<ChainId, PublicClient>();

  constructor(options: EvmWalletBalanceReaderOptions) {
    this.#options = options;
  }

  async balances(query: WalletBalanceQuery): Promise<readonly Money[]> {
    const client = this.#clientFor(query.chain);
    const address = getAddress(query.address);
    const native = this.#options.nativeAssets?.[query.chain];
    const balances: Money[] = [];

    for (const asset of query.assets) {
      if (asset === native) {
        balances.push(money(await this.#read(client.getBalance({ address })), asset));
        continue;
      }

      const token = this.#options.tokens[query.chain]?.[asset];
      // Skipped, not zero: a deployment that never configured this token knows
      // nothing about the merchant's balance in it, and reporting zero would
      // read as an empty wallet.
      if (token === undefined) continue;

      balances.push(
        money(
          await this.#read(
            client.readContract({
              address: getAddress(token),
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [address],
            }),
          ),
          asset,
        ),
      );
    }

    return balances;
  }

  #clientFor(chain: ChainId): PublicClient {
    const cached = this.#clients.get(chain);
    if (cached !== undefined) return cached;

    const url = this.#options.rpcUrls[chain];
    if (url === undefined) {
      throw new ProviderError(`No RPC URL configured for ${chain}`, { chain });
    }

    const client = createPublicClient({ chain: VIEM_CHAINS[chain], transport: http(url) });
    this.#clients.set(chain, client);
    return client;
  }

  /** Retryable: a merchant refreshing the screen is the retry. */
  async #read<T>(promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      throw new ProviderError(
        `Reading a wallet balance failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
        { cause: error, retryable: true },
      );
    }
  }
}
