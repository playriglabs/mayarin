/**
 * Chainlink price oracle adapter (RFC #7).
 *
 * Implements the `PriceOracle` port with a `latestRoundData()` read against an
 * AggregatorV3 feed through viem — the off-chain reference/cross-check beside
 * Pyth's. Deliberately thin, matching `EvmChainClient`: two view calls, no
 * caching beyond the feed's immutable `decimals()`, no staleness policy of its
 * own — `observedAt` is the round's `updatedAt`, and the freshness judgement
 * belongs to the deviation guard.
 *
 * The `feeds` map is deployment configuration from pair to on-chain feed, and
 * owns every equivalence (backing `ETH/USDC` with an ETH/USD aggregator is the
 * deployment's stated judgement). A missing pair or RPC URL is a
 * `ConfigurationError`; no symmetry or cross-rate derivation happens here.
 */

import type { ChainId } from "@mayarin/chain";
import type { OraclePrice, PriceOracle } from "@mayarin/clearing";
import { rateKey } from "@mayarin/clearing";
import { type AssetCode, assetDecimals, ConfigurationError, ProviderError } from "@mayarin/shared";
import {
  type Chain,
  createPublicClient,
  getAddress,
  http,
  type PublicClient,
  parseAbi,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { assertUsableRound, scaleAnswer } from "./aggregator.ts";

const AGGREGATOR_V3_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);

const CHAINS: Record<ChainId, Chain> = {
  base,
  "base-sepolia": baseSepolia,
};

export interface ChainlinkFeed {
  readonly chain: ChainId;
  /** AggregatorV3 (or proxy) contract address. */
  readonly address: string;
}

export interface ChainlinkPriceOracleOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  /** Pair (`rateKey(from, to)`) to on-chain feed, e.g. `"ETH/USDC": { chain, address }`. */
  readonly feeds: Readonly<Record<string, ChainlinkFeed>>;
}

export class ChainlinkPriceOracle implements PriceOracle {
  readonly #rpcUrls: ChainlinkPriceOracleOptions["rpcUrls"];
  readonly #feeds: ReadonlyMap<string, ChainlinkFeed>;
  readonly #clients = new Map<ChainId, PublicClient>();
  /** `decimals()` is immutable per aggregator; read once, keyed by chain:address. */
  readonly #decimals = new Map<string, number>();

  constructor(options: ChainlinkPriceOracleOptions) {
    this.#rpcUrls = options.rpcUrls;
    this.#feeds = new Map(Object.entries(options.feeds));
  }

  async reference(from: AssetCode, to: AssetCode): Promise<OraclePrice> {
    const feed = this.#feeds.get(rateKey(from, to));
    if (feed === undefined) {
      throw new ConfigurationError(`No Chainlink feed configured for ${from} -> ${to}`, {
        from,
        to,
      });
    }

    const address = getAddress(feed.address);
    const client = this.#clientFor(feed.chain);

    const feedDecimals = await this.#feedDecimals(client, feed.chain, address);
    const [, answer, , updatedAt] = await this.#rpc(
      feed.chain,
      client.readContract({ address, abi: AGGREGATOR_V3_ABI, functionName: "latestRoundData" }),
    );

    assertUsableRound({ answer, updatedAt }, from, to);

    const scaledRate = scaleAnswer(answer, feedDecimals, assetDecimals(to));
    if (scaledRate <= 0n) {
      throw new ProviderError(
        `Chainlink answer for ${from} -> ${to} rounds to zero minor units of ${to}`,
        { from, to, answer: answer.toString(), feedDecimals },
      );
    }

    return {
      from,
      to,
      scaledRate,
      source: "chainlink",
      observedAt: new Date(Number(updatedAt) * 1_000),
    };
  }

  async #feedDecimals(
    client: PublicClient,
    chain: ChainId,
    address: `0x${string}`,
  ): Promise<number> {
    const key = `${chain}:${address}`;
    const cached = this.#decimals.get(key);
    if (cached !== undefined) return cached;

    const decimals = await this.#rpc(
      chain,
      client.readContract({ address, abi: AGGREGATOR_V3_ABI, functionName: "decimals" }),
    );
    this.#decimals.set(key, decimals);
    return decimals;
  }

  #clientFor(chain: ChainId): PublicClient {
    const cached = this.#clients.get(chain);
    if (cached !== undefined) return cached;

    const url = this.#rpcUrls[chain];
    if (url === undefined) {
      throw new ConfigurationError(`No RPC URL configured for ${chain}`, { chain });
    }

    const client = createPublicClient({ chain: CHAINS[chain], transport: http(url) });
    this.#clients.set(chain, client);
    return client;
  }

  /** RPC faults are retryable: the next quote attempt reads a fresh round. */
  async #rpc<T>(chain: ChainId, promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ProviderError(
        `Chainlink read failed on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        { chain },
        { cause: error, retryable: true },
      );
    }
  }
}
