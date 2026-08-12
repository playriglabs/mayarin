/**
 * viem-backed chain client.
 *
 * Deliberately thin: three RPC calls, no caching, no reorg logic. The policy
 * that decides what a transfer means lives in `@mayarin/chain`, which is what
 * lets it be tested without a network.
 */

import type {
  AssetBalance,
  BalanceQuery,
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
import { shortReason } from "./errors.ts";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);
const BALANCE_OF = parseAbiItem("function balanceOf(address) view returns (uint256)");

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
  /**
   * The chain's own currency, which has no contract and emits no log.
   *
   * Configured rather than assumed: every chain here is EVM today and every one
   * of them is ETH, but a chain whose native asset is not ETH would otherwise
   * be silently scanned as if it were.
   */
  readonly nativeAssets?: Readonly<Partial<Record<ChainId, AssetCode>>>;
  /**
   * Blocks per `eth_getLogs` call.
   *
   * A provider limit, not a policy one: Alchemy's free tier refuses a range
   * wider than ten. Left as the watcher's whole range, that cap became the
   * watcher's catch-up rate — ten blocks per tick against a chain producing
   * seven and a half, so an hour of downtime took four hours to work off and
   * any real outage never closed at all.
   *
   * Splitting the range into calls the provider will answer decouples the two:
   * how far the watcher advances per tick is now a decision about RPC budget,
   * not a number dictated by one endpoint's limit.
   */
  readonly logRange?: number;
  /**
   * How many times viem retries one RPC call before giving up.
   *
   * One, not viem's three. A provider answering 429 is not a blip to ride out:
   * three exponential retries turn every rate-limited call into seconds of
   * waiting, and the calls that wait include the one a payer's page is blocked
   * on. The watcher's next tick re-scans the same range anyway — that is the
   * retry, and it costs nothing while it waits.
   */
  readonly retryCount?: number;
  /** Per-call ceiling, so a stalled provider cannot hold a request open. */
  readonly timeoutMs?: number;
}

export class EvmChainClient implements ChainClient {
  readonly #rpcUrls: EvmChainClientOptions["rpcUrls"];
  readonly #tokens: EvmChainClientOptions["tokens"];
  readonly #nativeAssets: NonNullable<EvmChainClientOptions["nativeAssets"]>;
  readonly #logRange: bigint;
  readonly #retryCount: number;
  readonly #timeoutMs: number;
  readonly #clients = new Map<ChainId, PublicClient>();

  constructor(options: EvmChainClientOptions) {
    this.#rpcUrls = options.rpcUrls;
    this.#tokens = options.tokens;
    this.#nativeAssets = options.nativeAssets ?? {};
    // Ten is the tightest cap seen in the wild (Alchemy free tier), so it is
    // the default a deployment gets without being asked.
    this.#logRange = BigInt(Math.max(1, options.logRange ?? 10));
    this.#retryCount = options.retryCount ?? 1;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
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

    // The chain's own currency moves without a contract and without a log, so
    // there is nothing for `eth_getLogs` to match. Block bodies are where a
    // native transfer is visible at all.
    if (this.#nativeAssets[query.chain] === query.asset) {
      return this.#nativeTransfers(query);
    }

    const token = this.#tokenAddress(query.chain, query.asset);
    const to = query.addresses.map((address) => getAddress(address));
    const client = this.#clientFor(query.chain);

    // Split into windows the provider will answer. One wide call and a series
    // of narrow ones return the same logs; only the second is a request every
    // tier accepts.
    const logs = [];
    for (const [fromBlock, toBlock] of windows(query.fromBlock, query.toBlock, this.#logRange)) {
      logs.push(
        ...(await this.#rpc(
          query.chain,
          client.getLogs({
            address: token,
            event: TRANSFER_EVENT,
            args: { to },
            fromBlock,
            toBlock,
          }),
        )),
      );
    }

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

    // Windowed for the same reason the transfer scan is: the settlement indexer
    // falls behind on exactly the outages the watcher does, and a catch-up it
    // cannot perform is a merchant whose settled payment stays open.
    const client = this.#clientFor(query.chain);
    const logs = [];
    for (const [fromBlock, toBlock] of windows(query.fromBlock, query.toBlock, this.#logRange)) {
      logs.push(
        ...(await this.#rpc(
          query.chain,
          client.getLogs({
            address: getAddress(query.router),
            event: PAYMENT_COMPLETED_EVENT,
            fromBlock,
            toBlock,
          }),
        )),
      );
    }

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

  /**
   * Native transfers, read from block bodies.
   *
   * One `eth_getBlockByNumber` per block in the range, against one
   * `eth_getLogs` for the whole range on the ERC-20 path — so the cost scales
   * with `WATCHER_BLOCK_RANGE` rather than being flat in it. Size that setting
   * against the RPC tier; the watcher already bounds each pass.
   *
   * Chosen over polling `eth_getBalance` per deposit address because a balance
   * is a number with no transaction attached: no `txHash`, no sender, and no
   * block hash for `classifyDeposit` to probe. The reorg and confirmation
   * policy is reused here **unchanged**, which is the point.
   *
   * **Only top-level transfers.** ETH moved by a contract — an exchange
   * sweeping through a router — is an internal transaction, invisible in a
   * block body. `trace_block` sees those; not every provider tier serves it.
   */
  async #nativeTransfers(query: TransferQuery): Promise<TransferLog[]> {
    const watched = new Set(query.addresses.map((address) => address.toLowerCase()));
    const client = this.#clientFor(query.chain);
    const transfers: TransferLog[] = [];

    for (let height = query.fromBlock; height <= query.toBlock; height += 1n) {
      const block = await this.#rpc(
        query.chain,
        client.getBlock({ blockNumber: height, includeTransactions: true }),
      );
      if (block.hash === null || block.number === null) continue;

      for (const transaction of block.transactions) {
        if (typeof transaction === "string") continue;
        if (transaction.to === null || transaction.value <= 0n) continue;
        if (!watched.has(transaction.to.toLowerCase())) continue;

        transfers.push({
          chain: query.chain,
          asset: query.asset,
          txHash: transaction.hash,
          // Deposits are unique on `(chain, txHash, logIndex)`, and a native
          // transfer has no log index to offer. A real one is never negative,
          // so -1 cannot collide with an ERC-20 transfer that happens to share
          // the transaction — which is exactly what index 0 would have done.
          logIndex: -1,
          blockNumber: block.number,
          blockHash: block.hash,
          from: transaction.from.toLowerCase(),
          to: transaction.to.toLowerCase(),
          amount: transaction.value,
        });
      }
    }

    return transfers;
  }

  /**
   * What each watched address holds at one settled block.
   *
   * The complement to the block-body scan, and the reason it exists: a block
   * body lists only top-level transactions, so ETH moved by a contract — a
   * smart-contract wallet, an exchange sweeping through a router — never
   * appears there. A balance sees it however it arrived.
   *
   * Read at one pinned height, and the block's hash is fetched with it, so the
   * observation carries the same `(blockNumber, blockHash)` pair a transfer log
   * does and the reorg probe applies to it unchanged.
   *
   * One `eth_getBalance` per open payment, not per block — the cost scales with
   * how many payments are waiting rather than with how far the scan has to
   * walk.
   */
  async balances(query: BalanceQuery): Promise<AssetBalance[]> {
    if (query.addresses.length === 0) return [];

    const client = this.#clientFor(query.chain);
    const block = await this.#rpc(query.chain, client.getBlock({ blockNumber: query.block }));
    if (block.hash === null || block.number === null) return [];

    const balances: AssetBalance[] = [];
    const native = this.#nativeAssets[query.chain] === query.asset;
    for (const address of query.addresses) {
      const account = getAddress(address);
      const amount = await this.#rpc(
        query.chain,
        native
          ? client.getBalance({ address: account, blockNumber: query.block })
          : client.readContract({
              address: this.#tokenAddress(query.chain, query.asset),
              abi: [BALANCE_OF],
              functionName: "balanceOf",
              args: [account],
              blockNumber: query.block,
            }),
      );
      balances.push({
        address: address.toLowerCase(),
        amount,
        blockNumber: block.number,
        blockHash: block.hash,
      });
    }
    return balances;
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
      transport: http(url, { retryCount: this.#retryCount, timeout: this.#timeoutMs }),
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
      // Named rather than folded into "RPC call failed", because the operator's
      // action is different: a rate limit is a budget to widen or a tick to
      // slow, not an endpoint to fix. Reported in one line — viem's own error
      // prints thirty, which is how a throttled watcher reads as a crash.
      if (isRateLimited(error)) {
        throw new ProviderError(
          `EVM RPC rate limited on ${chain}; the next tick re-scans the same range`,
          { chain, rateLimited: true },
          { cause: error, retryable: true },
        );
      }
      throw new ProviderError(
        `EVM RPC call failed for ${chain}: ${shortReason(error)}`,
        { chain },
        { cause: error, retryable: true },
      );
    }
  }
}

/** Splits an inclusive block range into windows of at most `size` blocks. */
function windows(from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
  const ranges: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    ranges.push([start, end > to ? to : end]);
  }
  return ranges;
}

/** A provider saying "slow down", however it phrases it. */
function isRateLimited(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: unknown }).status;
  return status === 429 || /429|too many requests|rate.?limit/i.test(error.message);
}

function isBlockNotFound(error: unknown): boolean {
  // viem's BlockNotFoundError reads "Block at number X could not be found."; some
  // providers phrase it "block not found". Match either, case-insensitively.
  return error instanceof Error && /block.*(?:not found|could not be found)/i.test(error.message);
}
