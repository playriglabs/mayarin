/**
 * Quote engine — guarded composition (RFC #6, first increment).
 *
 * The quote flow the RFC specifies is: reference price (oracle) → executable
 * quote (venue) → deviation check → lock and sign. This module owns the first
 * three steps: it composes the venue's executable price with the oracle's
 * independent reference and runs the deviation guard before anything downstream
 * derives a `minOut` from the executable price. The lock (#39) and the signed
 * order (#40) build on the `ComposedQuote` this produces.
 *
 * The venue seam is deliberately the existing `PriceSource` port — an
 * executable price for (pair, amount) is exactly what a DEX or aggregator
 * source already provides, and the Execution Engine (#5) owns real venue
 * selection; when it arrives, its venue exposes the same surface rather than
 * this package growing a rival one.
 *
 * Same-asset pairs need no quote at all: the contract path takes the no-swap
 * branch (#5) and the deposit path uses the `LiquidityRouter`'s identity rate.
 * Asking this engine for one is a wiring mistake, and it throws
 * `ConfigurationError` — the same stance `TablePriceSource` takes.
 */

import type {
  DeviationPolicy,
  OraclePrice,
  PriceOracle,
  PriceQuote,
  PriceSource,
} from "@mayarin/clearing";
import { guardExecutablePrice } from "@mayarin/clearing";
import { type AssetCode, type Clock, ConfigurationError, type Money } from "@mayarin/shared";

/** A deviation-guarded executable quote, with the reference that vouched for it. */
export interface ComposedQuote {
  readonly from: AssetCode;
  readonly to: AssetCode;
  /** The venue's executable price — what `minOut` will be derived from. */
  readonly executable: PriceQuote;
  /** The oracle observation the executable price was checked against. */
  readonly reference: OraclePrice;
  readonly composedAt: Date;
}

export interface QuoteEngineOptions {
  /** Executable side: a DEX/aggregator source (or the table, in dev). */
  readonly venue: PriceSource;
  /** Reference side: Pyth, Chainlink, or a fake. */
  readonly oracle: PriceOracle;
  readonly policy: DeviationPolicy;
  readonly clock: Clock;
}

export class QuoteEngine {
  readonly #venue: PriceSource;
  readonly #oracle: PriceOracle;
  readonly #policy: DeviationPolicy;
  readonly #clock: Clock;

  constructor(options: QuoteEngineOptions) {
    this.#venue = options.venue;
    this.#oracle = options.oracle;
    this.#policy = options.policy;
    this.#clock = options.clock;
  }

  /**
   * Composes a guarded executable quote for `amount` of `from` into `to`.
   *
   * The amount is passed through to the venue so size-aware sources price
   * slippage — which means a swap large enough to move the pool past the
   * deviation bound fails here, before any lock exists. Guard failures
   * (stale reference, excessive deviation) surface unchanged: retryable
   * `ProviderError`s the caller's retry branch already understands.
   */
  async compose(from: AssetCode, to: AssetCode, amount: Money): Promise<ComposedQuote> {
    if (from === to) {
      throw new ConfigurationError(
        `A same-asset pair needs no quote: ${from} -> ${to} takes the no-swap path`,
        { from, to },
      );
    }

    const executable = await this.#venue.price(from, to, amount);
    const reference = await this.#oracle.reference(from, to);
    const composedAt = this.#clock.now();

    guardExecutablePrice(executable, reference, this.#policy, composedAt);

    return { from, to, executable, reference, composedAt };
  }
}
