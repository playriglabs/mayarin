/**
 * 0x swap venue adapter (RFC #5 — #45, routes #57).
 *
 * Implements `RoutingSwapVenue` over the 0x Swap API v2. Two reads, split on
 * cost and commitment:
 *
 * - `quote` calls the **`/price`** endpoint — the planning-time read the
 *   selector (#48) and the planner (#44) consume.
 * - `route` calls the **`/swap/allowance-holder/quote`** endpoint and returns
 *   the transaction fragment the `PaymentRouter` runs. AllowanceHolder, not
 *   Permit2: the taker is the router contract, which grants an exact ERC-20
 *   allowance and cannot produce a Permit2 signature. The `taker` parameter
 *   is the router, and the swap output lands there — the contract measures
 *   its own balance delta.
 *
 * The route embeds 0x's default slippage floor, not the signed lock — the
 * contract's hard revert on the signed `minOut` stays the enforcement.
 *
 * The `pairs` map is deployment configuration from pair to token addresses,
 * and it owns every equivalence: which contract address backs `ETH` or
 * `USDC` on the configured chain is the deployment's stated judgement, not
 * something this adapter infers. A missing pair is a `ConfigurationError`;
 * no symmetry or cross-rate derivation happens here, matching the other
 * price seams.
 */

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
import { scaleSwapRate, zeroExPriceResponseSchema, zeroExRouteResponseSchema } from "./swap-api.ts";

export const DEFAULT_ZEROEX_ENDPOINT = "https://api.0x.org";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** The token contract addresses 0x trades for one configured pair. */
export interface ZeroExPair {
  readonly sellToken: string;
  readonly buyToken: string;
}

export interface ZeroExSwapVenueOptions {
  /** Pair (`rateKey(from, to)`) to token addresses, e.g. `"ETH/USDC": {…}`. */
  readonly pairs: Readonly<Record<string, ZeroExPair>>;
  readonly chainId: number;
  readonly apiKey: string;
  readonly endpoint?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export class ZeroExSwapVenue implements RoutingSwapVenue {
  readonly name = "0x";
  readonly #pairs: ReadonlyMap<string, ZeroExPair>;
  readonly #chainId: number;
  readonly #apiKey: string;
  readonly #endpoint: string;
  readonly #fetchFn: typeof fetch;

  constructor(options: ZeroExSwapVenueOptions) {
    this.#pairs = new Map(Object.entries(options.pairs));
    this.#chainId = options.chainId;
    this.#apiKey = options.apiKey;
    this.#endpoint = options.endpoint ?? DEFAULT_ZEROEX_ENDPOINT;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async quote(from: AssetCode, to: AssetCode, amount: Money): Promise<PriceQuote> {
    const pair = this.#sellArgs(from, to, amount);

    const json = await this.#request("/swap/permit2/price", this.#query(pair, amount), from, to);
    const parsed = zeroExPriceResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw this.#shapeError(from, to, parsed.error.issues);
    }
    const body = parsed.data;
    if (!body.liquidityAvailable) {
      throw new ProviderError(`0x has no liquidity for ${from} -> ${to}`, { from, to });
    }

    const sellAmount = BigInt(body.sellAmount);
    const buyAmount = BigInt(body.buyAmount);
    if (sellAmount <= 0n) {
      throw new ProviderError(`0x priced a zero sell amount for ${from} -> ${to}`, { from, to });
    }

    const minorUnitsPerWholeUnit = scaleSwapRate(sellAmount, buyAmount, assetDecimals(from));
    if (minorUnitsPerWholeUnit <= 0n) {
      throw new ProviderError(`0x price for ${from} -> ${to} rounds to zero minor units of ${to}`, {
        from,
        to,
        sellAmount: body.sellAmount,
        buyAmount: body.buyAmount,
      });
    }

    return { from, to, minorUnitsPerWholeUnit, source: this.name };
  }

  async route(request: RouteRequest): Promise<SwapRoute> {
    const { payerAsset: from, settlementAsset: to, amount, recipient } = request;
    const pair = this.#sellArgs(from, to, amount);
    if (!ADDRESS_PATTERN.test(recipient)) {
      throw new ValidationError("The recipient must be a 20-byte hex address", { recipient });
    }

    const query = this.#query(pair, amount);
    query.set("taker", recipient);
    const json = await this.#request("/swap/allowance-holder/quote", query, from, to);
    const parsed = zeroExRouteResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw this.#shapeError(from, to, parsed.error.issues);
    }
    if (!parsed.data.liquidityAvailable) {
      throw new ProviderError(`0x has no liquidity for ${from} -> ${to}`, { from, to });
    }

    const { transaction } = parsed.data;
    return {
      venue: this.name,
      to: transaction.to,
      data: transaction.data,
      value: BigInt(transaction.value ?? "0"),
    };
  }

  /** Shared sell-side validation and pair lookup. */
  #sellArgs(from: AssetCode, to: AssetCode, amount: Money): ZeroExPair {
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
      throw new ConfigurationError(`No 0x pair configured for ${from} -> ${to}`, { from, to });
    }
    return pair;
  }

  #query(pair: ZeroExPair, amount: Money): URLSearchParams {
    return new URLSearchParams({
      chainId: String(this.#chainId),
      sellToken: pair.sellToken,
      buyToken: pair.buyToken,
      sellAmount: amount.amount.toString(),
    });
  }

  #shapeError(from: AssetCode, to: AssetCode, issues: readonly { message: string }[]) {
    return new ProviderError(`0x response for ${from} -> ${to} has an unexpected shape`, {
      from,
      to,
      issues: issues.map((issue) => issue.message),
    });
  }

  /** The shared fetch ladder: network fault, HTTP failure, non-JSON body. */
  async #request(
    path: string,
    query: URLSearchParams,
    from: AssetCode,
    to: AssetCode,
  ): Promise<unknown> {
    const url = `${this.#endpoint}${path}?${query}`;
    const headers = { "0x-api-key": this.#apiKey, "0x-version": "v2" };

    let response: Response;
    try {
      response = await this.#fetchFn(url, { headers });
    } catch (error) {
      throw new ProviderError(
        `0x request for ${from} -> ${to} failed`,
        { from, to },
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new ProviderError(`0x responded ${response.status} for ${from} -> ${to}`, {
        from,
        to,
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw new ProviderError(
        `0x response for ${from} -> ${to} is not JSON`,
        { from, to },
        { cause: error },
      );
    }
  }
}
