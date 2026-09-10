/**
 * Uniswap swap venue adapter (RFC #5 — #46).
 *
 * Implements the `SwapVenue` port with a `quoteExactInputSingle` read against
 * Uniswap's QuoterV2 through viem — the planning-time read the selector
 * (#48) and the planner (#44) consume. Deliberately thin, matching the
 * Chainlink adapter (#34): one view call, a per-chain client cache, and no
 * routing of its own — one pool per configured pair.
 *
 * The `pools` map is deployment configuration from pair to chain, token
 * addresses and fee tier, and it owns every equivalence: which contract
 * address backs `ETH` or `USDC`, and which fee tier carries the pair, is the
 * deployment's stated judgement, not something this adapter infers. A
 * missing pair, quoter or RPC URL is a `ConfigurationError`; no symmetry or
 * cross-rate derivation happens here, matching the other price seams.
 */

import type { ChainId } from "@mayarin/chain";
import type { PriceQuote } from "@mayarin/clearing";
import { rateKey } from "@mayarin/clearing";
import type { SwapVenue } from "@mayarin/execution";
import { VIEM_CHAINS } from "@mayarin/provider-viem-chains";
import {
  type AssetCode,
  assetDecimals,
  ConfigurationError,
  type Money,
  ProviderError,
  ValidationError,
} from "@mayarin/shared";
import { createPublicClient, getAddress, http, type PublicClient, parseAbi } from "viem";
import { scaleSwapRate } from "./quoter.ts";

// QuoterV2 declares the function nonpayable, but it mutates no committed
// state — declaring it `view` here routes the read through `eth_call`, the
// standard way to consume the quoter off-chain.
const QUOTER_V2_ABI = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  // Note the argument order: exact-output names the *output* token first.
  "struct QuoteExactOutputSingleParams { address tokenIn; address tokenOut; uint256 amount; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactOutputSingle(QuoteExactOutputSingleParams params) view returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

/** The pool one configured pair trades through. */
export interface UniswapPool {
  readonly chain: ChainId;
  readonly tokenIn: string;
  readonly tokenOut: string;
  /** Fee tier in hundredths of a basis point, e.g. 500 for 0.05%. */
  readonly fee: number;
}

/**
 * A pool is unique by chain and pair, not by pair alone. Configuration keys may
 * use either `PAIR` for a single-chain pair or `CHAIN:PAIR` when the same pair
 * exists on several chains; the pool's own `chain` remains authoritative.
 */
function configuredPair(key: string): string {
  const separator = key.indexOf(":");
  return separator === -1 ? key : key.slice(separator + 1);
}

export function uniswapPoolKey(chain: ChainId, pair: string): string {
  return `${chain}:${pair}`;
}

export interface UniswapSwapVenueOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  /** QuoterV2 contract address per chain. */
  readonly quoters: Readonly<Partial<Record<ChainId, string>>>;
  /** Pair (`rateKey(from, to)`) to pool, e.g. `"ETH/USDC": { chain, …, fee }`. */
  readonly pools: Readonly<Record<string, UniswapPool>>;
}

export class UniswapSwapVenue implements SwapVenue {
  readonly name = "uniswap";
  readonly #rpcUrls: UniswapSwapVenueOptions["rpcUrls"];
  readonly #quoters: UniswapSwapVenueOptions["quoters"];
  readonly #pools: ReadonlyMap<string, UniswapPool>;
  readonly #clients = new Map<ChainId, PublicClient>();

  constructor(options: UniswapSwapVenueOptions) {
    this.#rpcUrls = options.rpcUrls;
    this.#quoters = options.quoters;
    this.#pools = new Map(
      Object.entries(options.pools).map(([key, pool]) => [
        uniswapPoolKey(pool.chain, configuredPair(key)),
        pool,
      ]),
    );
  }

  /**
   * What the pool charges to deliver exactly `exactOut`.
   *
   * The direction the contract actually trades in, and the one that needs no
   * guess about size — see `SwapVenue.quoteExactOutput`.
   */
  async quoteExactOutput(
    from: AssetCode,
    to: AssetCode,
    exactOut: Money,
    chain?: ChainId,
  ): Promise<PriceQuote> {
    if (exactOut.asset !== to) {
      throw new ValidationError(
        `The exact output asset ${exactOut.asset} must equal the buy asset ${to}`,
        { exactOutAsset: exactOut.asset, to },
      );
    }
    if (exactOut.amount <= 0n) {
      throw new ValidationError(`The exact output must be positive`, {
        from,
        to,
        amount: exactOut.amount.toString(),
      });
    }

    const pool = this.#poolFor(from, to, chain);
    const quoterAddress = this.#quoterFor(pool);

    const [amountIn] = await this.#rpc(
      pool.chain,
      this.#clientFor(pool.chain).readContract({
        address: getAddress(quoterAddress),
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactOutputSingle",
        args: [
          {
            tokenIn: getAddress(pool.tokenIn),
            tokenOut: getAddress(pool.tokenOut),
            amount: exactOut.amount,
            fee: pool.fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
    );

    if (amountIn <= 0n) {
      throw new ProviderError(`Uniswap quoted zero in for ${from} -> ${to}`, { from, to });
    }

    // The effective rate over the real trade, so a `minOut` derived from it is
    // one the pool can fill at that size rather than at one whole unit.
    const scaledRate = scaleSwapRate(amountIn, exactOut.amount, assetDecimals(from));
    if (scaledRate <= 0n) {
      throw new ProviderError(
        `Uniswap quote for ${from} -> ${to} rounds to zero minor units of ${to}`,
        { from, to, amountIn: amountIn.toString(), amountOut: exactOut.amount.toString() },
      );
    }

    return { from, to, scaledRate, source: this.name };
  }

  #quoterFor(pool: UniswapPool): string {
    const quoterAddress = this.#quoters[pool.chain];
    if (quoterAddress === undefined) {
      throw new ConfigurationError(`No Uniswap quoter configured for ${pool.chain}`, {
        chain: pool.chain,
      });
    }
    return quoterAddress;
  }

  /** The configured pool for a pair, refused when it is on another chain. */
  #poolFor(from: AssetCode, to: AssetCode, chain: ChainId | undefined): UniswapPool {
    const pair = rateKey(from, to);
    const candidates = [...this.#pools.entries()]
      .filter(([key]) => key.endsWith(`:${pair}`))
      .map(([, pool]) => pool);

    if (chain === undefined) {
      const only = candidates[0];
      if (only !== undefined && candidates.length === 1) return only;
      if (candidates.length > 1) {
        throw new ConfigurationError(`Uniswap pool for ${pair} requires a chain`, {
          pair,
          chains: candidates.map((pool) => pool.chain),
        });
      }
      throw new ConfigurationError(`No Uniswap pool configured for ${from} -> ${to}`, { from, to });
    }

    const pool = this.#pools.get(uniswapPoolKey(chain, pair));
    if (pool !== undefined) return pool;

    const other = candidates[0];
    if (other !== undefined) {
      throw new ConfigurationError(`Uniswap pool for ${pair} is on ${other.chain}, not ${chain}`, {
        pair,
        poolChain: other.chain,
        chain,
      });
    }
    throw new ConfigurationError(`No Uniswap pool configured for ${from} -> ${to}`, { from, to });
  }

  async quote(from: AssetCode, to: AssetCode, amount: Money, chain?: ChainId): Promise<PriceQuote> {
    if (amount.asset !== from) {
      throw new ValidationError(
        `The amount asset ${amount.asset} must equal the sell asset ${from}`,
        { amountAsset: amount.asset, from },
      );
    }
    if (amount.amount <= 0n) {
      throw new ValidationError(`The sell amount must be positive`, {
        from,
        to,
        amount: amount.amount.toString(),
      });
    }

    const pool = this.#poolFor(from, to, chain);

    const quoterAddress = this.#quoters[pool.chain];
    if (quoterAddress === undefined) {
      throw new ConfigurationError(`No Uniswap quoter configured for ${pool.chain}`, {
        chain: pool.chain,
      });
    }

    const client = this.#clientFor(pool.chain);
    const [amountOut] = await this.#rpc(
      pool.chain,
      client.readContract({
        address: getAddress(quoterAddress),
        abi: QUOTER_V2_ABI,
        functionName: "quoteExactInputSingle",
        args: [
          {
            tokenIn: getAddress(pool.tokenIn),
            tokenOut: getAddress(pool.tokenOut),
            amountIn: amount.amount,
            fee: pool.fee,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
    );

    if (amountOut <= 0n) {
      throw new ProviderError(`Uniswap quoted zero out for ${from} -> ${to}`, { from, to });
    }

    const scaledRate = scaleSwapRate(amount.amount, amountOut, assetDecimals(from));
    if (scaledRate <= 0n) {
      throw new ProviderError(
        `Uniswap quote for ${from} -> ${to} rounds to zero minor units of ${to}`,
        { from, to, amountIn: amount.amount.toString(), amountOut: amountOut.toString() },
      );
    }

    return { from, to, scaledRate, source: this.name };
  }

  #clientFor(chain: ChainId): PublicClient {
    const cached = this.#clients.get(chain);
    if (cached !== undefined) return cached;

    const url = this.#rpcUrls[chain];
    if (url === undefined) {
      throw new ConfigurationError(`No RPC URL configured for ${chain}`, { chain });
    }

    const client = createPublicClient({ chain: VIEM_CHAINS[chain], transport: http(url) });
    this.#clients.set(chain, client);
    return client;
  }

  /** RPC faults are retryable: the next quote attempt reads a fresh pool state. */
  async #rpc<T>(chain: ChainId, promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ProviderError(
        `Uniswap read failed on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        { chain },
        { cause: error, retryable: true },
      );
    }
  }
}
