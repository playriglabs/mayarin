/**
 * Swap venue port (RFC #5, first increment — #44).
 *
 * A venue is where a swap can execute: a DEX or an aggregator (0x, Uniswap,
 * LiFi). The port gives one thing: an executable quote for an amount of one
 * asset into another. The executable `minOut` always comes from a venue,
 * never from the oracle — the oracle (#7) only guards deviation.
 *
 * A venue also exposes the `PriceSource` view, through `priceSourceOf`. Then
 * the quote engine (#42) and the planner consume one seam, and no second
 * price port exists. Venue adapters live in `packages/providers/*` and keep
 * the network out of core.
 */

import type { PriceQuote, PriceSource } from "@mayarin/clearing";
import type { AssetCode, Money } from "@mayarin/shared";

export interface SwapVenue {
  /** The venue name, as configuration and plans refer to it ("0x", "uniswap"). */
  readonly name: string;
  /**
   * An executable quote for `amount` of `from` into `to`. Cross-asset only.
   * The venue throws `ConfigurationError` for a pair that it cannot serve.
   */
  quote(from: AssetCode, to: AssetCode, amount: Money): Promise<PriceQuote>;
}

/** The `PriceSource` view of a venue, for `QuoteEngine.compose`. */
export function priceSourceOf(venue: SwapVenue): PriceSource {
  return {
    price: (from, to, amount) => venue.quote(from, to, amount),
  };
}
