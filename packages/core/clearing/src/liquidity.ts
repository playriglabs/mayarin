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

import type { ChainId } from "@mayarin/chain";
import {
  type AssetCode,
  assetDecimals,
  ConfigurationError,
  type Money,
  RATE_SCALE,
  scaledRateFrom,
} from "@mayarin/shared";
import { type RateProvider, type RateQuote, rateKey } from "./rate.ts";

/** A priced conversion of `from` into `to`. */
export interface PriceQuote {
  readonly from: AssetCode;
  readonly to: AssetCode;
  /** Minor units of `to` per one whole unit of `from`. */
  readonly scaledRate: bigint;
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
  /**
   * Price `amount` of `from` into `to`, or throw if this source cannot.
   *
   * `chain` is the chain the payment runs on, when there is one. A venue whose
   * pool is on another chain must refuse with a `ConfigurationError` rather
   * than answer, because the price it would give is a different pool's — and
   * the swap will execute against the pool on `chain`. A source with nothing
   * chain-specific to say (the table, an FX rate) ignores it.
   */
  price(from: AssetCode, to: AssetCode, amount: Money, chain?: ChainId): Promise<PriceQuote>;

  /**
   * Price backwards: what rate holds when the swap must deliver exactly
   * `exactOut`?
   *
   * `price` answers at a size the caller has to guess, and a payment's size is
   * not known until the fiat leg is priced — so the contract path probed one
   * whole unit and locked a `minOut` derived from it. On a deep pool that is a
   * fair approximation; on a thin one it is not. Measured on Base Sepolia: one
   * EURC quoted 0.817981 USDC, and the 4.885472 EURC the payer was then asked
   * for delivered only 0.752620 each — the swap reverted `STF` against a
   * `minOut` the pool could never fill, after the payer had already paid.
   *
   * The settlement amount is known *before* the swap leg is priced, so asking
   * in this direction removes the guess rather than refining it.
   *
   * Optional, because a source with no depth prices the same at every size: a
   * rate table and an oracle are already exact, and `price` is their answer.
   */
  priceExactOutput?(
    from: AssetCode,
    to: AssetCode,
    exactOut: Money,
    chain?: ChainId,
  ): Promise<PriceQuote>;
}

/**
 * The first configured source that can price this chain.
 *
 * The pricing-side twin of `FallbackRouteSource`. A quote engine holds one
 * `PriceSource`, so a deployment with a V3 pool on one chain and a V2 pool on
 * another priced every payment against whichever venue was configured first —
 * including payments on the chain that venue has no pool on. The lock then
 * carried a price from a pool the swap would never touch.
 *
 * Only a `ConfigurationError` is routed around: a real venue or RPC fault is
 * rethrown rather than reported as "no source".
 */
export class FallbackPriceSource implements PriceSource {
  readonly #sources: readonly PriceSource[];

  constructor(sources: readonly PriceSource[]) {
    this.#sources = sources;
  }

  async price(from: AssetCode, to: AssetCode, amount: Money, chain?: ChainId): Promise<PriceQuote> {
    return this.#first(from, to, chain, (source) => source.price(from, to, amount, chain));
  }

  async priceExactOutput(
    from: AssetCode,
    to: AssetCode,
    exactOut: Money,
    chain?: ChainId,
  ): Promise<PriceQuote> {
    return this.#first(from, to, chain, (source) =>
      source.priceExactOutput === undefined
        ? Promise.reject(
            new ConfigurationError(`${from} -> ${to} cannot be priced by exact output here`, {
              from,
              to,
            }),
          )
        : source.priceExactOutput(from, to, exactOut, chain),
    );
  }

  async #first(
    from: AssetCode,
    to: AssetCode,
    chain: ChainId | undefined,
    ask: (source: PriceSource) => Promise<PriceQuote>,
  ): Promise<PriceQuote> {
    let lastError: unknown;
    for (const source of this.#sources) {
      try {
        return await ask(source);
      } catch (error) {
        if (!(error instanceof ConfigurationError)) throw error;
        lastError = error;
      }
    }
    if (lastError !== undefined) throw lastError;
    throw new ConfigurationError(`No price source is configured for ${from} -> ${to}`, {
      from,
      to,
      ...(chain === undefined ? {} : { chain }),
    });
  }
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
    // `EXCHANGE_RATES` is written in the readable form — minor units of `to`
    // per whole unit of `from` — so it is scaled here rather than making every
    // deployment write nine zeros.
    return { from, to, scaledRate: configured * RATE_SCALE, source: this.#source };
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
 * `scaledRate` is derived from the input/output so the engine's
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
        scaledRate: scaledRateFrom(pool.reserveTo * scaleFrom, pool.reserveFrom),
        source: this.#source,
      };
    }

    const amountInAfterFee = (amountInMinor * BigInt(10_000 - feeBps)) / 10_000n;
    // x·y=k: out = (inAfterFee * reserveTo) / (reserveFrom + inAfterFee).
    // Integer division truncates — the remainder stays in the pool.
    const amountOutMinor =
      (amountInAfterFee * pool.reserveTo) / (pool.reserveFrom + amountInAfterFee);

    // minor units of `to` per one whole unit of `from`, so convert() reproduces
    // amountOutMinor exactly (up to its own half-up rounding). Rounded down at
    // RATE_DECIMALS: an executable rate must never read better than the pool.
    const scaledRate = scaledRateFrom(amountOutMinor * scaleFrom, amountInMinor, "down");

    return { from, to, scaledRate, source: this.#source };
  }
}

export interface LiquidityRouterOptions {
  readonly source: PriceSource;
}

/**
 * Liquidity router: a `RateProvider` that prices cross-asset quotes through a
 * pluggable `PriceSource`. Same-asset quotes are the identity rate
 * (`10^decimals(to)` minor units of `to` per whole unit of `from`) and never
 * reach the source — one whole unit of X is one whole unit of X regardless of
 * source. Cross-asset quotes delegate to `source.price` and lift the
 * `PriceQuote` into a `RateQuote`; the shapes already match.
 *
 * Swapping `StaticRateProvider` for `LiquidityRouter` is a one-line change in
 * the composition root; the clearing engine, `#lockPrice`, `#lockDeposit`, and
 * `lockRate` do not change.
 */
export class LiquidityRouter implements RateProvider {
  readonly #source: PriceSource;

  constructor(options: LiquidityRouterOptions) {
    this.#source = options.source;
  }

  async quote(from: AssetCode, to: AssetCode, amount: Money, chain?: ChainId): Promise<RateQuote> {
    if (from === to) {
      return {
        from,
        to,
        scaledRate: 10n ** BigInt(assetDecimals(to)) * RATE_SCALE,
        source: "identity",
      };
    }
    const priced = await this.#source.price(from, to, amount, chain);
    return {
      from: priced.from,
      to: priced.to,
      scaledRate: priced.scaledRate,
      source: priced.source,
      ...(priced.expiresAt === undefined ? {} : { expiresAt: new Date(priced.expiresAt) }),
    };
  }
}
