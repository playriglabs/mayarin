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

import type { ChainId } from "@mayarin/chain";
import type { PriceQuote, PriceSource } from "@mayarin/clearing";
import type { AssetCode, Money } from "@mayarin/shared";

export interface SwapVenue {
  /** The venue name, as configuration and plans refer to it ("0x", "uniswap"). */
  readonly name: string;
  /**
   * An executable quote for `amount` of `from` into `to`. Cross-asset only.
   * The venue throws `ConfigurationError` for a pair that it cannot serve.
   *
   * `chain` is the chain the payment runs on. A venue whose pool is on another
   * chain refuses, exactly as its route source does — the price it would give
   * is a different pool's, and the swap executes on `chain`. Absent means the
   * caller has no chain to name and the venue prices whatever it holds.
   */
  quote(from: AssetCode, to: AssetCode, amount: Money, chain?: ChainId): Promise<PriceQuote>;

  /**
   * The rate that holds when the swap must deliver exactly `exactOut`.
   *
   * The contract is exact-output — it enforces `minOut` and refunds the rest —
   * so this is the direction that actually describes the trade. `quote`'s
   * exact-input answer has to be taken at a size the caller guesses, and a
   * guess one whole unit wide locked a `minOut` a thin pool could not fill.
   *
   * A venue that cannot price backwards (an aggregator built around "spend
   * this much") refuses with a `ConfigurationError`, exactly as its route
   * source does, and the caller falls back to one that can.
   */
  quoteExactOutput(
    from: AssetCode,
    to: AssetCode,
    exactOut: Money,
    chain?: ChainId,
  ): Promise<PriceQuote>;
}

/** The `PriceSource` view of a venue, for `QuoteEngine.compose`. */
export function priceSourceOf(venue: SwapVenue): PriceSource {
  return {
    price: (from, to, amount, chain) => venue.quote(from, to, amount, chain),
    priceExactOutput: (from, to, exactOut, chain) =>
      venue.quoteExactOutput(from, to, exactOut, chain),
  };
}
