/**
 * Uniswap V2 executable-route adapter.
 *
 * Like the V3 route source, the route is **encoded** rather than fetched —
 * `UniswapV2Router02` is a contract, so this builds the calldata for an
 * exact-output swap the `PaymentRouter` executes. One pair, one hop.
 *
 * **Exact-output** via `swapTokensForExactTokens`: `amountOut` is the merchant's
 * locked `minOut` and `amountInMax` is the payer's bound. The pair takes what it
 * needs and the router returns the unspent input remainder to the caller — the
 * `PaymentRouter`, which forwards it to `refundTo`.
 *
 * `recipient` is the PaymentRouter, not the merchant: the contract measures its
 * own settlement-balance delta, so a route paying the merchant directly settles
 * nothing and reverts on `minOut`.
 *
 * V2's router carries a `deadline` the V3 `SwapRouter02` dropped. The
 * `PaymentRouter` already enforces the signed order's deadline, so the router's
 * own is redundant and set to a far-future value to never trip — the payment's
 * real expiry is the contract's, not the router's.
 */

import type { ChainId } from "@mayarin/chain";
import { rateKey } from "@mayarin/clearing";
import type { ExecutableRoute, RouteRequest, SwapRouteSource } from "@mayarin/execution";
import { ConfigurationError, money } from "@mayarin/shared";
import { encodeFunctionData } from "viem";
import type { UniswapV2Pair } from "./adapter.ts";

const SWAP_ROUTER_02_ABI = [
  {
    type: "function",
    name: "swapTokensForExactTokens",
    stateMutability: "nonpayable",
    inputs: [
      { type: "uint256", name: "amountOut" },
      { type: "uint256", name: "amountInMax" },
      { type: "address[]", name: "path" },
      { type: "address", name: "to" },
      { type: "uint256", name: "deadline" },
    ],
    outputs: [{ type: "uint256[]", name: "amounts" }],
  },
] as const;

/** Far-future deadline: the PaymentRouter enforces the real one. */
const FAR_FUTURE_DEADLINE = 2n ** 64n - 1n;

export interface UniswapV2RouteSourceOptions {
  /** `UniswapV2Router02` address per chain. */
  readonly routers: Readonly<Partial<Record<ChainId, string>>>;
  /** Pair (`rateKey(from, to)`) to pair — the same map the venue prices against. */
  readonly pairs: Readonly<Record<string, UniswapV2Pair>>;
}

export class UniswapV2RouteSource implements SwapRouteSource {
  readonly name = "uniswap-v2";
  readonly #routers: UniswapV2RouteSourceOptions["routers"];
  readonly #pairs: ReadonlyMap<string, UniswapV2Pair>;

  constructor(options: UniswapV2RouteSourceOptions) {
    this.#routers = options.routers;
    this.#pairs = new Map(Object.entries(options.pairs));
  }

  async route(request: RouteRequest): Promise<ExecutableRoute> {
    const key = rateKey(request.payerAsset, request.settlementAsset);
    const pair = this.#pairs.get(key);
    if (pair === undefined) {
      throw new ConfigurationError(`Uniswap V2 has no configured pair for ${key}`, {
        pair: key,
        configured: [...this.#pairs.keys()],
      });
    }
    // A V2 pair lives on one chain. Routing it from another chain's
    // PaymentRouter would call a router that has no code there, so refuse here
    // and let the caller fall back to a venue whose pair is on this chain.
    if (pair.chain !== request.chain) {
      throw new ConfigurationError(
        `Uniswap V2 pair for ${key} is on ${pair.chain}, not ${request.chain}`,
        { pair: key, pairChain: pair.chain, chain: request.chain },
      );
    }
    const router = this.#routers[pair.chain];
    if (router === undefined) {
      throw new ConfigurationError(`No Uniswap V2 router configured for ${pair.chain}`, {
        pair: key,
        chain: pair.chain,
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
        abi: SWAP_ROUTER_02_ABI,
        functionName: "swapTokensForExactTokens",
        args: [
          request.exactOut.amount,
          request.maxIn.amount,
          [pair.tokenIn as `0x${string}`, pair.tokenOut as `0x${string}`],
          request.recipient as `0x${string}`,
          FAR_FUTURE_DEADLINE,
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
