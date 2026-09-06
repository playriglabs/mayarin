/**
 * Uniswap V2 swap venue adapter.
 *
 * Implements the `SwapVenue` port with a `getAmountsOut` read against a
 * UniswapV2Router02 — the planning-time price the quote engine consumes. V2
 * has no QuoterV2: the router itself prices off the pair's reserves, so one
 * contract address per chain serves both quote and route.
 *
 * Like the V3 adapter, the `pairs` map is deployment configuration from pair to
 * chain and token addresses, and it owns every equivalence. A missing pair,
 * router or RPC URL is a `ConfigurationError`; no symmetry or cross-rate
 * derivation happens here. A V2 pair has no fee tier — V2 pools are flat-fee.
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

const ROUTER_ABI = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[] amounts)",
  "function getAmountsIn(uint256 amountOut, address[] path) external view returns (uint256[] amounts)",
]);

/** The pair one configured pair-key trades through. V2 has no fee tier. */
export interface UniswapV2Pair {
  readonly chain: ChainId;
  readonly tokenIn: string;
  readonly tokenOut: string;
}

export interface UniswapV2SwapVenueOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  /** UniswapV2Router02 address per chain. */
  readonly routers: Readonly<Partial<Record<ChainId, string>>>;
  /** Pair (`rateKey(from, to)`) to pair, e.g. `"EURC/USDC": { chain, tokenIn, tokenOut }`. */
  readonly pairs: Readonly<Record<string, UniswapV2Pair>>;
}

export class UniswapV2SwapVenue implements SwapVenue {
  readonly name = "uniswap-v2";
  readonly #rpcUrls: UniswapV2SwapVenueOptions["rpcUrls"];
  readonly #routers: UniswapV2SwapVenueOptions["routers"];
  readonly #pairs: ReadonlyMap<string, UniswapV2Pair>;
  readonly #clients = new Map<ChainId, PublicClient>();

  constructor(options: UniswapV2SwapVenueOptions) {
    this.#rpcUrls = options.rpcUrls;
    this.#routers = options.routers;
    this.#pairs = new Map(Object.entries(options.pairs));
  }

  /**
   * What the pair charges to deliver exactly `exactOut`.
   *
   * `getAmountsIn` is V2's exact-output read, and it is the direction the
   * contract trades in — see `SwapVenue.quoteExactOutput`.
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

    const pair = this.#pairFor(from, to, chain);
    const routerAddress = this.#routerFor(pair);

    const amounts = await this.#rpc(
      pair.chain,
      this.#clientFor(pair.chain).readContract({
        address: getAddress(routerAddress),
        abi: ROUTER_ABI,
        functionName: "getAmountsIn",
        args: [exactOut.amount, [getAddress(pair.tokenIn), getAddress(pair.tokenOut)]],
      }),
    );

    const amountIn = amounts[0];
    if (amountIn === undefined || amountIn <= 0n) {
      throw new ProviderError(`Uniswap V2 quoted zero in for ${from} -> ${to}`, { from, to });
    }

    // The effective rate over the real trade, so a `minOut` derived from it is
    // one the pair can fill at that size rather than at one whole unit.
    const scaledRate = scaleSwapRate(amountIn, exactOut.amount, assetDecimals(from));
    if (scaledRate <= 0n) {
      throw new ProviderError(
        `Uniswap V2 quote for ${from} -> ${to} rounds to zero minor units of ${to}`,
        { from, to, amountIn: amountIn.toString(), amountOut: exactOut.amount.toString() },
      );
    }

    return { from, to, scaledRate, source: this.name };
  }

  #routerFor(pair: UniswapV2Pair): string {
    const routerAddress = this.#routers[pair.chain];
    if (routerAddress === undefined) {
      throw new ConfigurationError(`No Uniswap V2 router configured for ${pair.chain}`, {
        chain: pair.chain,
      });
    }
    return routerAddress;
  }

  /** The configured pair, refused when it is on another chain. */
  #pairFor(from: AssetCode, to: AssetCode, chain: ChainId | undefined): UniswapV2Pair {
    const pair = this.#pairs.get(rateKey(from, to));
    if (pair === undefined) {
      throw new ConfigurationError(`No Uniswap V2 pair configured for ${from} -> ${to}`, {
        from,
        to,
      });
    }
    // The same refusal `UniswapV2RouteSource` makes, one step earlier.
    if (chain !== undefined && pair.chain !== chain) {
      throw new ConfigurationError(
        `Uniswap V2 pair for ${rateKey(from, to)} is on ${pair.chain}, not ${chain}`,
        { pair: rateKey(from, to), pairChain: pair.chain, chain },
      );
    }
    return pair;
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

    const pair = this.#pairs.get(rateKey(from, to));
    if (pair === undefined) {
      throw new ConfigurationError(`No Uniswap V2 pair configured for ${from} -> ${to}`, {
        from,
        to,
      });
    }

    // The same refusal `UniswapV2RouteSource` makes, one step earlier. Pricing
    // a payment against a pair on another chain locks a rate from a pool the
    // swap will never touch; the caller falls back to a venue whose pair is on
    // this chain.
    if (chain !== undefined && pair.chain !== chain) {
      throw new ConfigurationError(
        `Uniswap V2 pair for ${rateKey(from, to)} is on ${pair.chain}, not ${chain}`,
        { pair: rateKey(from, to), pairChain: pair.chain, chain },
      );
    }

    const routerAddress = this.#routers[pair.chain];
    if (routerAddress === undefined) {
      throw new ConfigurationError(`No Uniswap V2 router configured for ${pair.chain}`, {
        chain: pair.chain,
      });
    }

    const client = this.#clientFor(pair.chain);
    const amounts = await this.#rpc(
      pair.chain,
      client.readContract({
        address: getAddress(routerAddress),
        abi: ROUTER_ABI,
        functionName: "getAmountsOut",
        args: [amount.amount, [getAddress(pair.tokenIn), getAddress(pair.tokenOut)]],
      }),
    );

    const amountOut = amounts[1];
    if (amountOut === undefined || amountOut <= 0n) {
      throw new ProviderError(`Uniswap V2 quoted zero out for ${from} -> ${to}`, { from, to });
    }

    const scaledRate = scaleSwapRate(amount.amount, amountOut, assetDecimals(from));
    if (scaledRate <= 0n) {
      throw new ProviderError(
        `Uniswap V2 quote for ${from} -> ${to} rounds to zero minor units of ${to}`,
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

  async #rpc<T>(chain: ChainId, promise: Promise<T>): Promise<T> {
    try {
      return await promise;
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ProviderError(
        `Uniswap V2 read failed on ${chain}: ${error instanceof Error ? error.message : String(error)}`,
        { chain },
        { cause: error, retryable: true },
      );
    }
  }
}
