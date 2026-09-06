/**
 * 0x swap venue adapter (RFC #5 — #45).
 *
 * Implements the `SwapVenue` port over the 0x Swap API v2 price endpoint —
 * the planning-time read the selector (#48) and the planner (#44) consume.
 * The firm-quote endpoint, which also returns transaction calldata, is the
 * calldata builder's step (#49) and deliberately not called here.
 *
 * The `pairs` map is deployment configuration from pair to token addresses,
 * and it owns every equivalence: which contract address backs `ETH` or
 * `USDC` on the configured chain is the deployment's stated judgement, not
 * something this adapter infers. A missing pair is a `ConfigurationError`;
 * no symmetry or cross-rate derivation happens here, matching the other
 * price seams.
 */

import { type ChainId, EVM_CHAIN_IDS } from "@mayarin/chain";
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
import { scaleSwapRate, zeroExPriceResponseSchema } from "./swap-api.ts";

export const DEFAULT_ZEROEX_ENDPOINT = "https://api.0x.org";

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

export class ZeroExSwapVenue implements SwapVenue {
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
      throw new ConfigurationError(`No 0x pair configured for ${from} -> ${to}`, { from, to });
    }

    // The same refusal `ZeroExRouteSource` makes, one step earlier: 0x serves
    // one configured chain, and a price from that chain does not describe a
    // swap that will execute on another.
    if (chain !== undefined && EVM_CHAIN_IDS[chain] !== BigInt(this.#chainId)) {
      throw new ConfigurationError(
        `0x is configured for chain id ${this.#chainId}, not ${chain} (${EVM_CHAIN_IDS[chain]})`,
        { pair: rateKey(from, to), chain, configuredChainId: this.#chainId },
      );
    }

    const body = await this.#price(pair, from, to, { sellAmount: amount.amount });
    if (!body.liquidityAvailable) {
      throw new ProviderError(`0x has no liquidity for ${from} -> ${to}`, { from, to });
    }

    const sellAmount = BigInt(body.sellAmount);
    const buyAmount = BigInt(body.buyAmount);
    if (sellAmount <= 0n) {
      throw new ProviderError(`0x priced a zero sell amount for ${from} -> ${to}`, { from, to });
    }

    const scaledRate = scaleSwapRate(sellAmount, buyAmount, assetDecimals(from));
    if (scaledRate <= 0n) {
      throw new ProviderError(`0x price for ${from} -> ${to} rounds to zero minor units of ${to}`, {
        from,
        to,
        sellAmount: body.sellAmount,
        buyAmount: body.buyAmount,
      });
    }

    return { from, to, scaledRate, source: this.name };
  }

  /**
   * What 0x charges to deliver exactly `exactOut`.
   *
   * 0x takes either `sellAmount` or `buyAmount`; `buyAmount` asks it to price
   * backwards, which is what `ZeroExRouteSource` already does and what the
   * contract actually trades — see `SwapVenue.quoteExactOutput`.
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

    const pair = this.#pairs.get(rateKey(from, to));
    if (pair === undefined) {
      throw new ConfigurationError(`No 0x pair configured for ${from} -> ${to}`, { from, to });
    }
    if (chain !== undefined && EVM_CHAIN_IDS[chain] !== BigInt(this.#chainId)) {
      throw new ConfigurationError(
        `0x is configured for chain id ${this.#chainId}, not ${chain} (${EVM_CHAIN_IDS[chain]})`,
        { pair: rateKey(from, to), chain, configuredChainId: this.#chainId },
      );
    }

    const body = await this.#price(pair, from, to, { buyAmount: exactOut.amount });
    if (!body.liquidityAvailable) {
      throw new ProviderError(`0x has no liquidity for ${from} -> ${to}`, { from, to });
    }

    const sellAmount = BigInt(body.sellAmount);
    const buyAmount = BigInt(body.buyAmount);
    if (sellAmount <= 0n || buyAmount <= 0n) {
      throw new ProviderError(`0x quoted a non-positive amount for ${from} -> ${to}`, { from, to });
    }

    const scaledRate = scaleSwapRate(sellAmount, buyAmount, assetDecimals(from));
    if (scaledRate <= 0n) {
      throw new ProviderError(`0x quote for ${from} -> ${to} rounds to zero minor units of ${to}`, {
        from,
        to,
        sellAmount: sellAmount.toString(),
        buyAmount: buyAmount.toString(),
      });
    }

    return { from, to, scaledRate, source: this.name };
  }

  async #price(
    pair: ZeroExPair,
    from: AssetCode,
    to: AssetCode,
    side: { readonly sellAmount: bigint } | { readonly buyAmount: bigint },
  ) {
    const query = new URLSearchParams({
      chainId: String(this.#chainId),
      sellToken: pair.sellToken,
      buyToken: pair.buyToken,
      ...("sellAmount" in side
        ? { sellAmount: side.sellAmount.toString() }
        : { buyAmount: side.buyAmount.toString() }),
    });
    const url = `${this.#endpoint}/swap/permit2/price?${query}`;
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

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new ProviderError(
        `0x response for ${from} -> ${to} is not JSON`,
        { from, to },
        { cause: error },
      );
    }

    const parsed = zeroExPriceResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(`0x response for ${from} -> ${to} has an unexpected shape`, {
        from,
        to,
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }
    return parsed.data;
  }
}
