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

import { type AssetCode, assetDecimals, ConfigurationError, type Money } from "@mayarin/shared";
import { rateKey } from "./rate.ts";

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

/**
 * Table price source: wraps the configured `EXCHANGE_RATES` record keyed
 * `"from/to"` — the shape `config.exchangeRates` already produces. Cross-asset
 * only; a same-asset call throws because identity is the `LiquidityRouter`'s
 * job, and a missing cross-asset pair throws `ConfigurationError` matching
 * `StaticRateProvider`.
 */
export class TablePriceSource implements PriceSource {
  readonly #rates: ReadonlyMap<string, bigint>;
  readonly #source: string;

  constructor(rates: Readonly<Record<string, bigint>> = {}, source = "table") {
    this.#rates = new Map(Object.entries(rates));
    this.#source = source;
  }

  async price(from: AssetCode, to: AssetCode, _amount: Money): Promise<PriceQuote> {
    if (from === to) {
      throw new ConfigurationError(
        `TablePriceSource prices cross-asset pairs only: ${from} -> ${to}`,
        {
          from,
          to,
        },
      );
    }
    const configured = this.#rates.get(rateKey(from, to));
    if (configured === undefined) {
      throw new ConfigurationError(`No rate configured for ${from} -> ${to}`, { from, to });
    }
    return { from, to, minorUnitsPerWholeUnit: configured, source: this.#source };
  }
}

/** Reserves for a constant-product pool, both in their asset's minor units. */
export interface ConstantProductPool {
  /** Reserve of `from` in its minor units. */
  readonly reserveFrom: bigint;
  /** Reserve of `to` in its minor units. */
  readonly reserveTo: bigint;
  /** Swap fee in basis points (0–10_000), taken from the input before the swap. */
  readonly feeBps?: number;
}

export interface ConstantProductPriceSourceOptions {
  readonly feeBps?: number;
  readonly source?: string;
}

/**
 * Constant-product (Uniswap-v2 `x·y=k`) price source with pure integer math.
 *
 * Reserves are BigInt minor units; the output amount is computed with integer
 * division that rounds in favour of the pool (the truncated remainder stays in
 * the pool, so the source never overstates what a swap yields). The returned
 * `minorUnitsPerWholeUnit` is derived from the input/output so the engine's
 * existing `convert` math — which already reasons in minor-units-per-whole-unit
 * — stays exact. No `number`, no `Math`, no rounding error reaches a balance.
 *
 * A pool for the reverse direction `(to, from)` is a separate configured
 * reserve pair; the source does not infer symmetry.
 */
export class ConstantProductPriceSource implements PriceSource {
  readonly #pools: ReadonlyMap<string, ConstantProductPool>;
  readonly #defaultFeeBps: number;
  readonly #source: string;

  constructor(
    pools: Readonly<Record<string, ConstantProductPool>>,
    options: ConstantProductPriceSourceOptions = {},
  ) {
    this.#pools = new Map(Object.entries(pools));
    this.#defaultFeeBps = options.feeBps ?? 0;
    this.#source = options.source ?? "constant-product";
  }

  async price(from: AssetCode, to: AssetCode, amount: Money): Promise<PriceQuote> {
    if (from === to) {
      throw new ConfigurationError(
        `ConstantProductPriceSource prices cross-asset pairs only: ${from} -> ${to}`,
        { from, to },
      );
    }
    const pool = this.#pools.get(rateKey(from, to));
    if (pool === undefined) {
      throw new ConfigurationError(`No pool configured for ${from} -> ${to}`, { from, to });
    }

    const feeBps = pool.feeBps ?? this.#defaultFeeBps;
    const amountInMinor = amount.amount;
    const scaleFrom = 10n ** BigInt(assetDecimals(from));

    // Marginal price for a zero/infinitesimal quote: reserveTo / reserveFrom,
    // lifted to minor units of `to` per whole unit of `from`.
    if (amountInMinor === 0n) {
      return {
        from,
        to,
        minorUnitsPerWholeUnit: (pool.reserveTo * scaleFrom) / pool.reserveFrom,
        source: this.#source,
      };
    }

    const amountInAfterFee = (amountInMinor * BigInt(10_000 - feeBps)) / 10_000n;
    // x·y=k: out = (inAfterFee * reserveTo) / (reserveFrom + inAfterFee).
    // Integer division truncates — the remainder stays in the pool.
    const amountOutMinor =
      (amountInAfterFee * pool.reserveTo) / (pool.reserveFrom + amountInAfterFee);

    // minor units of `to` per one whole unit of `from`, so convert() reproduces
    // amountOutMinor exactly (up to its own half-up rounding).
    const minorUnitsPerWholeUnit = (amountOutMinor * scaleFrom) / amountInMinor;

    return { from, to, minorUnitsPerWholeUnit, source: this.#source };
  }
}
