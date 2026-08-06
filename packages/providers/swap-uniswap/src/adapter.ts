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
import type { RouteRequest, RoutingSwapVenue, SwapRoute } from "@mayarin/execution";
import {
  type AssetCode,
  assetDecimals,
  ConfigurationError,
  type Money,
  ProviderError,
  ValidationError,
} from "@mayarin/shared";
import {
  type Chain,
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  type PublicClient,
  parseAbi,
} from "viem";
import { base, baseSepolia } from "viem/chains";
import { scaleSwapRate } from "./quoter.ts";

// QuoterV2 declares the function nonpayable, but it mutates no committed
// state — declaring it `view` here routes the read through `eth_call`, the
// standard way to consume the quoter off-chain.
const QUOTER_V2_ABI = parseAbi([
  "struct QuoteExactInputSingleParams { address tokenIn; address tokenOut; uint256 amountIn; uint24 fee; uint160 sqrtPriceLimitX96; }",
  "function quoteExactInputSingle(QuoteExactInputSingleParams params) view returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

// SwapRouter02 dropped the per-call deadline of the V1 router; order TTL is
// enforced by the PaymentRouter's signed `deadline` instead.
const SWAP_ROUTER_02_ABI = parseAbi([
  "struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }",
  "function exactInputSingle(ExactInputSingleParams params) payable returns (uint256 amountOut)",
]);

const CHAINS: Record<ChainId, Chain> = {
  base,
  "base-sepolia": baseSepolia,
};

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** The pool one configured pair trades through. */
export interface UniswapPool {
  readonly chain: ChainId;
  readonly tokenIn: string;
  readonly tokenOut: string;
  /** Fee tier in hundredths of a basis point, e.g. 500 for 0.05%. */
  readonly fee: number;
  /**
   * The pair sells the chain's native asset: the route carries the amount as
   * native value, and SwapRouter02 wraps it against the WETH `tokenIn`.
   */
  readonly nativeIn?: boolean;
}

export interface UniswapSwapVenueOptions {
  readonly rpcUrls: Readonly<Partial<Record<ChainId, string>>>;
  /** QuoterV2 contract address per chain. */
  readonly quoters: Readonly<Partial<Record<ChainId, string>>>;
  /** SwapRouter02 contract address per chain; needed by `route` only. */
  readonly routers?: Readonly<Partial<Record<ChainId, string>>>;
  /** Pair (`rateKey(from, to)`) to pool, e.g. `"ETH/USDC": { chain, …, fee }`. */
  readonly pools: Readonly<Record<string, UniswapPool>>;
}

export class UniswapSwapVenue implements RoutingSwapVenue {
  readonly name = "uniswap";
  readonly #rpcUrls: UniswapSwapVenueOptions["rpcUrls"];
  readonly #quoters: UniswapSwapVenueOptions["quoters"];
  readonly #routers: NonNullable<UniswapSwapVenueOptions["routers"]>;
  readonly #pools: ReadonlyMap<string, UniswapPool>;
  readonly #clients = new Map<ChainId, PublicClient>();

  constructor(options: UniswapSwapVenueOptions) {
    this.#rpcUrls = options.rpcUrls;
    this.#quoters = options.quoters;
    this.#routers = options.routers ?? {};
    this.#pools = new Map(Object.entries(options.pools));
  }

  async quote(from: AssetCode, to: AssetCode, amount: Money): Promise<PriceQuote> {
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

    const pool = this.#pools.get(rateKey(from, to));
    if (pool === undefined) {
      throw new ConfigurationError(`No Uniswap pool configured for ${from} -> ${to}`, { from, to });
    }

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

    const minorUnitsPerWholeUnit = scaleSwapRate(amount.amount, amountOut, assetDecimals(from));
    if (minorUnitsPerWholeUnit <= 0n) {
      throw new ProviderError(
        `Uniswap quote for ${from} -> ${to} rounds to zero minor units of ${to}`,
        { from, to, amountIn: amount.amount.toString(), amountOut: amountOut.toString() },
      );
    }

    return { from, to, minorUnitsPerWholeUnit, source: this.name };
  }

  /**
   * Encodes `SwapRouter02.exactInputSingle` locally — no network call. The
   * signed lock rides as `amountOutMinimum`, so a doomed fill reverts inside
   * the swap instead of at the contract's own `minOut` assert; the contract
   * stays the enforcement. `recipient` is the `PaymentRouter`, which grants
   * the router an exact allowance (or forwards native value for a
   * `nativeIn` pool).
   */
  async route(request: RouteRequest): Promise<SwapRoute> {
    const { payerAsset: from, settlementAsset: to, amount, recipient } = request;
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
    if (!ADDRESS_PATTERN.test(recipient)) {
      throw new ValidationError("The recipient must be a 20-byte hex address", { recipient });
    }

    const pool = this.#pools.get(rateKey(from, to));
    if (pool === undefined) {
      throw new ConfigurationError(`No Uniswap pool configured for ${from} -> ${to}`, { from, to });
    }
    const routerAddress = this.#routers[pool.chain];
    if (routerAddress === undefined) {
      throw new ConfigurationError(`No Uniswap router configured for ${pool.chain}`, {
        chain: pool.chain,
      });
    }

    const data = encodeFunctionData({
      abi: SWAP_ROUTER_02_ABI,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: getAddress(pool.tokenIn),
          tokenOut: getAddress(pool.tokenOut),
          fee: pool.fee,
          recipient: getAddress(recipient),
          amountIn: amount.amount,
          amountOutMinimum: request.minOut,
          sqrtPriceLimitX96: 0n,
        },
      ],
    });

    return {
      venue: this.name,
      to: getAddress(routerAddress),
      data,
      value: pool.nativeIn === true ? amount.amount : 0n,
    };
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
