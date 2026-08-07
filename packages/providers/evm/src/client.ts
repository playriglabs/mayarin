/**
 * viem-backed chain client.
 *
 * Deliberately thin: three RPC calls, no caching, no reorg logic. The policy
 * that decides what a transfer means lives in `@mayarin/chain`, which is what
 * lets it be tested without a network.
 */

import type {
  BlockRef,
  ChainClient,
  ChainId,
  SettlementLog,
  SettlementQuery,
  TransferLog,
  TransferQuery,
} from "@mayarin/chain";
import { paymentRouterAbi } from "@mayarin/contracts";
import { type AssetCode, ConfigurationError, ProviderError } from "@mayarin/shared";
import {
  type Chain,
  createPublicClient,
  getAddress,
  http,
  type PublicClient,
  parseAbiItem,
} from "viem";
import { base, baseSepolia } from "viem/chains";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

/**
 * Taken from the generated ABI rather than re-declared: a hand-written
 * signature that drifts from the contract yields the wrong topic hash, and the
 * failure mode is silence — the filter simply matches nothing.
 */
const PAYMENT_COMPLETED_EVENT = paymentRouterAbi.find(
  (entry): entry is Extract<typeof entry, { type: "event"; name: "PaymentCompleted" }> =>
    entry.type === "event" && entry.name === "PaymentCompleted",
);

// Typed as the generic `Chain` rather than `base | baseSepolia` so the public
// clients share one type: the op-stack chains specialise their block's
// `transactions` to include deposit transactions, which is unrelated to the
// generic client's block type and would otherwise force a cast everywhere.
const CHAINS: Record<ChainId, Chain> = {
  base,
  "base-sepolia": baseSepolia,
};

export interface EvmChainClientOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  /** ERC-20 contract address per chain and asset. */
  readonly tokens: Readonly<Partial<Record<ChainId, Readonly<Partial<Record<AssetCode, string>>>>>>;
}

export class EvmChainClient implements ChainClient {
  readonly #rpcUrls: EvmChainClientOptions["rpcUrls"];
  readonly #tokens: EvmChainClientOptions["tokens"];
  readonly #clients = new Map<ChainId, PublicClient>();

  constructor(options: EvmChainClientOptions) {
    this.#rpcUrls = options.rpcUrls;
    this.#tokens = options.tokens;
  }

  async head(chain: ChainId): Promise<BlockRef> {
    const block = await this.#rpc(chain, this.#clientFor(chain).getBlock({ blockTag: "latest" }));
    return { number: block.number ?? 0n, hash: block.hash ?? "" };
  }

  async blockHash(chain: ChainId, number: bigint): Promise<string | null> {
    try {
      const block = await this.#rpc(
        chain,
        this.#clientFor(chain).getBlock({ blockNumber: number }),
      );
      return block.hash;
    } catch (error) {
      // A height the chain has not reached is a normal answer during a reorg,
      // not a fault — the policy reads `null` as "no evidence either way".
      if (isBlockNotFound(error)) return null;
      throw error;
    }
  }

  async transfers(query: TransferQuery): Promise<TransferLog[]> {
    if (query.addresses.length === 0) return [];

    const token = this.#tokenAddress(query.chain, query.asset);
    const logs = await this.#rpc(
      query.chain,
      this.#clientFor(query.chain).getLogs({
        address: token,
        event: TRANSFER_EVENT,
        args: { to: query.addresses.map((address) => getAddress(address)) },
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
      }),
    );

    return logs.flatMap((log) => {
      if (log.blockNumber === null || log.blockHash === null || log.transactionHash === null) {
        return [];
      }
      if (log.logIndex === null || log.args.to === undefined || log.args.value === undefined) {
        return [];
      }
      return [
        {
          chain: query.chain,
          asset: query.asset,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          from: (log.args.from ?? "").toLowerCase(),
          to: log.args.to.toLowerCase(),
          amount: log.args.value,
        },
      ];
    });
  }

  async settlements(query: SettlementQuery): Promise<SettlementLog[]> {
    if (PAYMENT_COMPLETED_EVENT === undefined) {
      throw new ConfigurationError("The PaymentRouter ABI declares no PaymentCompleted event", {});
    }

    const logs = await this.#rpc(
      query.chain,
      this.#clientFor(query.chain).getLogs({
        address: getAddress(query.router),
        event: PAYMENT_COMPLETED_EVENT,
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
      }),
    );

    return logs.flatMap((log) => {
      // A log without a block or a transaction is a pending log, which
      // `getLogs` over a closed range should never return. Dropping it is
      // safer than recording a settlement with no place on the chain.
      if (log.blockNumber === null || log.blockHash === null || log.transactionHash === null) {
        return [];
      }
      if (log.logIndex === null) return [];

      const { intentId, merchantSafe, settledAmount, fee, refundAmount } = log.args;
      if (
        intentId === undefined ||
        merchantSafe === undefined ||
        settledAmount === undefined ||
        fee === undefined ||
        refundAmount === undefined
      ) {
        return [];
      }

      return [
        {
          chain: query.chain,
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
          blockHash: log.blockHash,
          intentId: intentId.toLowerCase(),
          merchantSafe: merchantSafe.toLowerCase(),
          settledAmount,
          fee,
          refundAmount,
        },
      ];
    });
  }

  #tokenAddress(chain: ChainId, asset: AssetCode): `0x${string}` {
    const address = this.#tokens[chain]?.[asset];
    if (address === undefined) {
      throw new ConfigurationError(`No token address configured for ${asset} on ${chain}`, {
        chain,
        asset,
      });
    }
    return getAddress(address);
  }

  #clientFor(chain: ChainId): PublicClient {
    const cached = this.#clients.get(chain);
    if (cached !== undefined) return cached;

    const url = this.#rpcUrls[chain];
    if (url === undefined) {
      throw new ConfigurationError(`No RPC URL configured for ${chain}`, {
        chain,
      });
    }

    const client = createPublicClient({
      chain: CHAINS[chain],
      transport: http(url),
    });
    this.#clients.set(chain, client);
    return client;
  }

  /** RPC faults are retryable: the watcher's next tick picks the work back up. */
  async #rpc<T>(chain: ChainId, promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ConfigurationError || isBlockNotFound(error)) throw error;
      throw new ProviderError(
        `EVM RPC call failed for ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        { chain },
        { cause: error, retryable: true },
      );
    }
  }
}

function isBlockNotFound(error: unknown): boolean {
  // viem's BlockNotFoundError reads "Block at number X could not be found."; some
  // providers phrase it "block not found". Match either, case-insensitively.
  return error instanceof Error && /block.*(?:not found|could not be found)/i.test(error.message);
}
