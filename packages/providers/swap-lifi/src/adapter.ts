/**
 * LiFi swap venue adapter (RFC #5 — #47, routes #57).
 *
 * Implements `RoutingSwapVenue` over the LiFi `/v1/quote` endpoint. The same
 * endpoint serves both reads, split by what the adapter keeps:
 *
 * - `quote` keeps the estimate only — the planning-time read the selector
 *   (#48) and the planner (#44) consume.
 * - `route` keeps the transaction request — the fragment the `PaymentRouter`
 *   runs (#57). `fromAddress` and `toAddress` are both the router: it
 *   executes the call (grants the exact allowance, or forwards native value)
 *   and it must receive the output, because it measures its own balance
 *   delta.
 *
 * Same-chain only: every configured pair quotes with the same chain on both
 * sides. Cross-chain execution stays with #19. The route embeds LiFi's
 * default slippage floor, not the signed lock — the contract's hard revert
 * on the signed `minOut` stays the enforcement.
 *
 * The `pairs` map is deployment configuration from pair to chain and token
 * addresses, and it owns every equivalence: which contract address backs
 * `ETH` or `USDC` on the configured chain is the deployment's stated
 * judgement, not something this adapter infers. A missing pair is a
 * `ConfigurationError`; no symmetry or cross-rate derivation happens here,
 * matching the other price seams.
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
import { lifiQuoteResponseSchema, lifiRouteResponseSchema, scaleSwapRate } from "./quote-api.ts";

export const DEFAULT_LIFI_ENDPOINT = "https://li.quest";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** The chain and token contract addresses LiFi quotes for one configured pair. */
export interface LifiPair {
  /** Numeric EVM chain id, on both sides of the quote (same-chain only). */
  readonly chainId: number;
  readonly fromToken: string;
  readonly toToken: string;
}

export interface LifiSwapVenueOptions {
  /** Pair (`rateKey(from, to)`) to chain and token addresses. */
  readonly pairs: Readonly<Record<string, LifiPair>>;
  /** The address planning quotes are priced for — LiFi requires one. */
  readonly fromAddress: string;
  /** Optional API key; LiFi serves unauthenticated requests at a lower rate limit. */
  readonly apiKey?: string;
  readonly endpoint?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export class LifiSwapVenue implements RoutingSwapVenue {
  readonly name = "lifi";
  readonly #pairs: ReadonlyMap<string, LifiPair>;
  readonly #fromAddress: string;
  readonly #apiKey: string | undefined;
  readonly #endpoint: string;
  readonly #fetchFn: typeof fetch;

  constructor(options: LifiSwapVenueOptions) {
    this.#pairs = new Map(Object.entries(options.pairs));
    this.#fromAddress = options.fromAddress;
    this.#apiKey = options.apiKey;
    this.#endpoint = options.endpoint ?? DEFAULT_LIFI_ENDPOINT;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async quote(from: AssetCode, to: AssetCode, amount: Money): Promise<PriceQuote> {
    const pair = this.#sellArgs(from, to, amount);

    const json = await this.#request(this.#query(pair, amount, this.#fromAddress), from, to);
    const parsed = lifiQuoteResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw this.#shapeError(from, to, parsed.error.issues);
    }

    const fromAmount = BigInt(parsed.data.estimate.fromAmount);
    const toAmount = BigInt(parsed.data.estimate.toAmount);
    if (fromAmount <= 0n) {
      throw new ProviderError(`LiFi priced a zero sell amount for ${from} -> ${to}`, { from, to });
    }

    const minorUnitsPerWholeUnit = scaleSwapRate(fromAmount, toAmount, assetDecimals(from));
    if (minorUnitsPerWholeUnit <= 0n) {
      throw new ProviderError(
        `LiFi quote for ${from} -> ${to} rounds to zero minor units of ${to}`,
        {
          from,
          to,
          fromAmount: parsed.data.estimate.fromAmount,
          toAmount: parsed.data.estimate.toAmount,
        },
      );
    }

    return { from, to, minorUnitsPerWholeUnit, source: this.name };
  }

  async route(request: RouteRequest): Promise<SwapRoute> {
    const { payerAsset: from, settlementAsset: to, amount, recipient } = request;
    const pair = this.#sellArgs(from, to, amount);
    if (!ADDRESS_PATTERN.test(recipient)) {
      throw new ValidationError("The recipient must be a 20-byte hex address", { recipient });
    }

    const query = this.#query(pair, amount, recipient);
    query.set("toAddress", recipient);
    const json = await this.#request(query, from, to);
    const parsed = lifiRouteResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw this.#shapeError(from, to, parsed.error.issues);
    }

    const { transactionRequest } = parsed.data;
    return {
      venue: this.name,
      to: transactionRequest.to,
      data: transactionRequest.data,
      value: BigInt(transactionRequest.value ?? "0x0"),
    };
  }

  /** Shared sell-side validation and pair lookup. */
  #sellArgs(from: AssetCode, to: AssetCode, amount: Money): LifiPair {
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
      throw new ConfigurationError(`No LiFi pair configured for ${from} -> ${to}`, { from, to });
    }
    return pair;
  }

  #query(pair: LifiPair, amount: Money, fromAddress: string): URLSearchParams {
    return new URLSearchParams({
      fromChain: String(pair.chainId),
      toChain: String(pair.chainId),
      fromToken: pair.fromToken,
      toToken: pair.toToken,
      fromAmount: amount.amount.toString(),
      fromAddress,
    });
  }

  #shapeError(from: AssetCode, to: AssetCode, issues: readonly { message: string }[]) {
    return new ProviderError(`LiFi response for ${from} -> ${to} has an unexpected shape`, {
      from,
      to,
      issues: issues.map((issue) => issue.message),
    });
  }

  /** The shared fetch ladder: network fault, HTTP failure, non-JSON body. */
  async #request(query: URLSearchParams, from: AssetCode, to: AssetCode): Promise<unknown> {
    const url = `${this.#endpoint}/v1/quote?${query}`;
    const headers: Record<string, string> =
      this.#apiKey === undefined ? {} : { "x-lifi-api-key": this.#apiKey };

    let response: Response;
    try {
      response = await this.#fetchFn(url, { headers });
    } catch (error) {
      throw new ProviderError(
        `LiFi request for ${from} -> ${to} failed`,
        { from, to },
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new ProviderError(`LiFi responded ${response.status} for ${from} -> ${to}`, {
        from,
        to,
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw new ProviderError(
        `LiFi response for ${from} -> ${to} is not JSON`,
        { from, to },
        { cause: error },
      );
    }
  }
}
