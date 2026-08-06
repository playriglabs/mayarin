/**
 * Uniswap executable-route adapter (RFC #5 — #57).
 *
 * Unlike 0x and LiFi, Uniswap has no quote *service* that hands back a
 * transaction — `SwapRouter02` is a contract, so the route is something this
 * adapter **encodes** rather than fetches. That makes it the cheapest venue to
 * route through (no network call, no rate limit, nothing to go stale) and the
 * least flexible: one pool, one hop, exactly the pool the deployment configured.
 *
 * **Exact-output** via `exactOutputSingle`: `amountOut` is the merchant's locked
 * `minOut` and `amountInMaximum` is the payer's bound. The pool takes what it
 * needs and `SwapRouter02` leaves the remainder with the caller — which is the
 * PaymentRouter, which returns it to the payer.
 *
 * `recipient` is the PaymentRouter, not the merchant: the contract measures its
 * own settlement-balance delta, so a route paying the merchant directly settles
 * nothing and reverts on `minOut`.
 */

import type { ChainId } from "@mayarin/chain";
import { rateKey } from "@mayarin/clearing";
import type { ExecutableRoute, RouteRequest, SwapRouteSource } from "@mayarin/execution";
import { ConfigurationError, money } from "@mayarin/shared";
import { encodeFunctionData } from "viem";
import type { UniswapPool } from "./adapter.ts";

/**
 * The one function this adapter encodes. `SwapRouter02` dropped the `deadline`
 * field its predecessor carried — the payment's own deadline is the signed
 * order's, enforced by `PaymentRouter`.
 */
export const swapRouter02Abi = [
  {
    type: "function",
    name: "exactOutputSingle",
    stateMutability: "payable",
    inputs: [
      {
        type: "tuple",
        name: "params",
        components: [
          { type: "address", name: "tokenIn" },
          { type: "address", name: "tokenOut" },
          { type: "uint24", name: "fee" },
          { type: "address", name: "recipient" },
          { type: "uint256", name: "amountOut" },
          { type: "uint256", name: "amountInMaximum" },
          { type: "uint160", name: "sqrtPriceLimitX96" },
        ],
      },
    ],
    outputs: [{ type: "uint256", name: "amountIn" }],
  },
] as const;

export interface UniswapRouteSourceOptions {
  /** `SwapRouter02` address per chain. */
  readonly swapRouters: Readonly<Partial<Record<ChainId, string>>>;
  /** Pair (`rateKey(from, to)`) to pool — the same map the venue prices against. */
  readonly pools: Readonly<Record<string, UniswapPool>>;
}

export class UniswapRouteSource implements SwapRouteSource {
  readonly name = "uniswap";
  readonly #swapRouters: UniswapRouteSourceOptions["swapRouters"];
  readonly #pools: ReadonlyMap<string, UniswapPool>;

  constructor(options: UniswapRouteSourceOptions) {
    this.#swapRouters = options.swapRouters;
    this.#pools = new Map(Object.entries(options.pools));
  }

  async route(request: RouteRequest): Promise<ExecutableRoute> {
    const key = rateKey(request.payerAsset, request.settlementAsset);
    const pool = this.#pools.get(key);
    if (pool === undefined) {
      throw new ConfigurationError(`Uniswap has no configured pool for ${key}`, {
        pair: key,
        configured: [...this.#pools.keys()],
      });
    }
    const router = this.#swapRouters[pool.chain];
    if (router === undefined) {
      throw new ConfigurationError(`No SwapRouter02 address configured for ${pool.chain}`, {
        pair: key,
        chain: pool.chain,
      });
    }
    if (request.exactOut.asset !== request.settlementAsset) {
      throw new ConfigurationError("The exact output must be in the settlement asset", {
        exactOutAsset: request.exactOut.asset,
        settlementAsset: request.settlementAsset,
      });
    }
    if (request.maxIn.asset !== request.payerAsset) {
      throw new ConfigurationError("The input bound must be in the payer asset", {
        maxInAsset: request.maxIn.asset,
        payerAsset: request.payerAsset,
      });
    }

    return {
      router,
      callData: encodeFunctionData({
        abi: swapRouter02Abi,
        functionName: "exactOutputSingle",
        args: [
          {
            tokenIn: pool.tokenIn as `0x${string}`,
            tokenOut: pool.tokenOut as `0x${string}`,
            fee: pool.fee,
            recipient: request.recipient as `0x${string}`,
            amountOut: request.exactOut.amount,
            amountInMaximum: request.maxIn.amount,
            // No price limit: `amountInMaximum` already bounds the payer's spend,
            // and a second bound would only add a way to fail for a reason the
            // caller did not choose.
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
      // Encoding cannot know the fill; the pool decides at execution. The
      // contract refunds whatever is unspent, so the bound is the honest answer
      // here rather than a guess dressed up as a quote.
      expectedIn: money(request.maxIn.amount, request.payerAsset),
      source: this.name,
    };
  }
}
