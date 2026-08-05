/**
 * Reference in-memory venue, in the segregated `/testing` subpath so domain
 * `src/` stays pure. The venue serves configured quotes verbatim and records
 * each call, so a test can make sure that the no-swap path calls no venue.
 */

import type { PriceQuote } from "@mayarin/clearing";
import { rateKey } from "@mayarin/clearing";
import { type AssetCode, ConfigurationError, type Money } from "@mayarin/shared";
import type { SwapVenue } from "../src/index.ts";

export interface RecordedVenueCall {
  readonly from: AssetCode;
  readonly to: AssetCode;
  readonly amount: bigint;
}

export class FixedSwapVenue implements SwapVenue {
  readonly name: string;
  readonly calls: RecordedVenueCall[] = [];
  readonly #quotes: ReadonlyMap<string, PriceQuote>;

  constructor(name: string, quotes: readonly PriceQuote[]) {
    this.name = name;
    this.#quotes = new Map(quotes.map((quote) => [rateKey(quote.from, quote.to), quote]));
  }

  async quote(from: AssetCode, to: AssetCode, amount: Money): Promise<PriceQuote> {
    this.calls.push({ from, to, amount: amount.amount });
    const quote = this.#quotes.get(rateKey(from, to));
    if (quote === undefined) {
      throw new ConfigurationError(`No quote configured for ${from} -> ${to}`, { from, to });
    }
    return quote;
  }
}
