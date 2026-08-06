/**
 * LiFi swap venue adapter (RFC #5 — #47).
 *
 * Implements the `SwapVenue` port over the LiFi quote API — the
 * planning-time read the selector (#48) and the planner (#44) consume.
 * Quotes only: the response's transaction request is the calldata builder's
 * step (#49), and cross-chain execution is out of scope here (#19 owns that
 * design), so every configured pair quotes with the same chain on both
 * sides.
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
import type { SwapVenue } from "@mayarin/execution";
import {
  type AssetCode,
  assetDecimals,
  ConfigurationError,
  type Money,
  ProviderError,
  ValidationError,
} from "@mayarin/shared";
import { lifiQuoteResponseSchema, scaleSwapRate } from "./quote-api.ts";

export const DEFAULT_LIFI_ENDPOINT = "https://li.quest";

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
  /** The address the quote is priced for — LiFi requires one. */
  readonly fromAddress: string;
  /** Optional API key; LiFi serves unauthenticated requests at a lower rate limit. */
  readonly apiKey?: string;
  readonly endpoint?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export class LifiSwapVenue implements SwapVenue {
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

    const body = await this.#quote(pair, from, to, amount.amount);

    const fromAmount = BigInt(body.estimate.fromAmount);
    const toAmount = BigInt(body.estimate.toAmount);
    if (fromAmount <= 0n) {
      throw new ProviderError(`LiFi priced a zero sell amount for ${from} -> ${to}`, { from, to });
    }

    const minorUnitsPerWholeUnit = scaleSwapRate(fromAmount, toAmount, assetDecimals(from));
    if (minorUnitsPerWholeUnit <= 0n) {
      throw new ProviderError(
        `LiFi quote for ${from} -> ${to} rounds to zero minor units of ${to}`,
        { from, to, fromAmount: body.estimate.fromAmount, toAmount: body.estimate.toAmount },
      );
    }

    return { from, to, minorUnitsPerWholeUnit, source: this.name };
  }

  async #quote(pair: LifiPair, from: AssetCode, to: AssetCode, fromAmount: bigint) {
    const query = new URLSearchParams({
      fromChain: String(pair.chainId),
      toChain: String(pair.chainId),
      fromToken: pair.fromToken,
      toToken: pair.toToken,
      fromAmount: fromAmount.toString(),
      fromAddress: this.#fromAddress,
    });
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

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new ProviderError(
        `LiFi response for ${from} -> ${to} is not JSON`,
        { from, to },
        { cause: error },
      );
    }

    const parsed = lifiQuoteResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(`LiFi response for ${from} -> ${to} has an unexpected shape`, {
        from,
        to,
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }
    return parsed.data;
  }
}
