/**
 * Reference in-memory venue, in the segregated `/testing` subpath so domain
 * `src/` stays pure. The venue serves configured quotes verbatim and records
 * each call, so a test can make sure that the no-swap path calls no venue.
 */

import type { PriceQuote } from "@mayarin/clearing";
import { rateKey } from "@mayarin/clearing";
import { type AssetCode, ConfigurationError, type Money } from "@mayarin/shared";
import type { RouteRequest, RoutingSwapVenue, SwapRoute, SwapVenue } from "../src/index.ts";

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

/**
 * Routing venue: serves configured routes verbatim, keyed by pair, and
 * records each request so a test can assert the recipient and the floor that
 * reached the venue.
 */
export class FixedRoutingVenue extends FixedSwapVenue implements RoutingSwapVenue {
  readonly routeCalls: RouteRequest[] = [];
  readonly #routes: ReadonlyMap<string, SwapRoute>;

  constructor(
    name: string,
    quotes: readonly PriceQuote[],
    routes: Readonly<Record<string, SwapRoute>> = {},
  ) {
    super(name, quotes);
    this.#routes = new Map(Object.entries(routes));
  }

  async route(request: RouteRequest): Promise<SwapRoute> {
    this.routeCalls.push(request);
    const route = this.#routes.get(rateKey(request.payerAsset, request.settlementAsset));
    if (route === undefined) {
      throw new ConfigurationError(
        `No route configured for ${request.payerAsset} -> ${request.settlementAsset}`,
        { from: request.payerAsset, to: request.settlementAsset },
      );
    }
    return route;
  }
}
