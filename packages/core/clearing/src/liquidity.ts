/**
 * Liquidity router and price sources.
 *
 * Phase 1 locks prices against a configured table through `RateProvider`,
 * implemented by `StaticRateProvider`. Phase 2C introduces a `LiquidityRouter`
 * that implements the same `RateProvider` port but prices cross-asset quotes
 * through a pluggable `PriceSource`, so the static table becomes one source
 * among many and a DEX or aggregator can be wired in (Phase 4) without touching
 * the clearing engine.
 *
 * Both ports live in core alongside `StaticRateProvider` — the precedent that a
 * pure rate implementation may live in core. A source that needs the network
 * (viem, an HTTP aggregator) would live in `packages/providers` and implement
 * `PriceSource`, keeping the network boundary out of core.
 */

import type { AssetCode, Money } from "@mayarin/shared";

/** A priced conversion of `from` into `to`. */
export interface PriceQuote {
  readonly from: AssetCode;
  readonly to: AssetCode;
  /** Minor units of `to` per one whole unit of `from`. */
  readonly minorUnitsPerWholeUnit: bigint;
  readonly source: string;
  readonly expiresAt?: Date;
}

/**
 * Price source: the seam a future DEX/aggregator implements.
 *
 * `price` is cross-asset only; same-asset identity is the `LiquidityRouter`'s
 * job, since one whole unit of X is one whole unit of X regardless of source.
 */
export interface PriceSource {
  /** Price `amount` of `from` into `to`, or throw if this source cannot. */
  price(from: AssetCode, to: AssetCode, amount: Money): Promise<PriceQuote>;
}
