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

import { type ChainId, isMainnetChain } from "@mayarin/chain";
import type {
  DeviationPolicy,
  OraclePrice,
  PriceOracle,
  PriceQuote,
  PriceSource,
} from "@mayarin/clearing";
import { guardExecutablePrice } from "@mayarin/clearing";
import { type AssetCode, type Clock, ConfigurationError, type Money } from "@mayarin/shared";
import { type FiatPricePolicy, priceInSettlement, type SettlementPrice } from "./fx.ts";

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
  /** Explicit chain+pair exceptions for unusable testnet oracle/liquidity data. */
  readonly unguardedTestnetPairs?: readonly string[];
  /** Governs the fiat leg: which pairs are pegged, and reference staleness. */
  readonly fiat: FiatPricePolicy;
  readonly clock: Clock;
}

/**
 * Both legs of a merchant-priced payment.
 *
 * The merchant prices in fiat and the payer pays in crypto, and those are two
 * different conversions with two different sources — an FX rate no DEX can
 * serve, and a swap price no oracle should be trusted to fill. Keeping them
 * separate in the result means a lock can record which source produced which
 * number, rather than presenting one blended rate whose provenance is lost.
 */
export interface FiatQuote {
  /** Fiat leg: the merchant's price in the asset they settle in. */
  readonly settlement: SettlementPrice;
  /** Swap leg: the guarded executable price from payer asset into settlement. */
  readonly composed: ComposedQuote;
}

export class QuoteEngine {
  readonly #venue: PriceSource;
  readonly #oracle: PriceOracle;
  readonly #policy: DeviationPolicy;
  readonly #unguardedTestnetPairs: readonly string[];
  readonly #fiat: FiatPricePolicy;
  readonly #clock: Clock;

  constructor(options: QuoteEngineOptions) {
    this.#venue = options.venue;
    this.#oracle = options.oracle;
    this.#policy = options.policy;
    this.#unguardedTestnetPairs = options.unguardedTestnetPairs ?? [];
    this.#fiat = options.fiat;
    this.#clock = options.clock;
  }

  /**
   * Prices a merchant's fiat amount for a payer paying in `payerAsset`.
   *
   * Two legs, because the product spans two kinds of conversion:
   *
   * 1. **Fiat → settlement** through the oracle (or a peg). No venue can price
   *    this; there is no IDR pool on any DEX.
   * 2. **Payer asset → settlement** through the venue, guarded by the oracle.
   *
   * `probe` is the payer-asset amount the venue is asked to price. Venue quotes
   * are size-aware, so a rate only means something at a size — and the size we
   * ultimately want is what this call is computing. The caller supplies a probe
   * near the expected order size; `lockQuote` then derives the real payer
   * estimate from the returned rate. A probe far from the true size gives a rate
   * that priced different depth, which is a real (if second-order) inaccuracy,
   * not something to paper over here.
   *
   * When the payer already holds the settlement asset there is no swap leg at
   * all: `composed` is absent and the contract takes its same-asset no-op path.
   */
  async quoteFiatPrice(args: {
    readonly price: Money;
    readonly settlementAsset: AssetCode;
    readonly payerAsset: AssetCode;
    readonly probe: Money;
    /**
     * The chain the swap leg will execute on, so the venue prices the pool the
     * payment will actually touch. Absent on a rail that has no chain.
     */
    readonly chain?: ChainId;
  }): Promise<FiatQuote | Omit<FiatQuote, "composed">> {
    const settlement = await priceInSettlement(
      this.#oracle,
      args.price,
      args.settlementAsset,
      this.#fiat,
      this.#clock.now(),
    );

    if (args.payerAsset === args.settlementAsset) {
      return { settlement };
    }

    return {
      settlement,
      composed: await this.#swapLeg(args, settlement.settlementAmount),
    };
  }

  /**
   * The swap leg, priced at the size it will actually execute at.
   *
   * `compose` has to be given a size, and before this the caller guessed one
   * whole unit of the payer's asset. That guess is only as good as the pool is
   * deep. Measured on Base Sepolia: one EURC quoted 0.817981 USDC, and the
   * 4.885472 EURC the payer was then asked for delivered 0.752620 each — so
   * the locked `minOut` sat 9% above what the pool could fill, and the swap
   * reverted `STF` after the payer had paid and their deposit had been swept.
   *
   * The settlement amount is known before this runs, and it is exactly what
   * the swap must deliver, so asking in that direction removes the guess
   * rather than narrowing it.
   *
   * A source with no depth — a rate table, an oracle — prices the same at
   * every size, so the probe is already its exact answer and it keeps that
   * path. A venue that has depth but cannot be asked backwards says so with a
   * `ConfigurationError`; any other failure is a fault, and is raised rather
   * than quietly downgrading the lock to the direction that caused this bug.
   */
  async #swapLeg(
    args: {
      readonly settlementAsset: AssetCode;
      readonly payerAsset: AssetCode;
      readonly probe: Money;
      readonly chain?: ChainId;
    },
    settlementAmount: Money,
  ): Promise<ComposedQuote> {
    const priceExactOutput = this.#venue.priceExactOutput;
    if (priceExactOutput !== undefined) {
      try {
        return await this.#composeWith(args.payerAsset, args.settlementAsset, args.chain, () =>
          priceExactOutput.call(
            this.#venue,
            args.payerAsset,
            args.settlementAsset,
            settlementAmount,
            args.chain,
          ),
        );
      } catch (error) {
        if (!(error instanceof ConfigurationError)) throw error;
      }
    }

    return this.compose(args.payerAsset, args.settlementAsset, args.probe, args.chain);
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
  async compose(
    from: AssetCode,
    to: AssetCode,
    amount: Money,
    chain?: ChainId,
  ): Promise<ComposedQuote> {
    return this.#composeWith(from, to, chain, () => this.#venue.price(from, to, amount, chain));
  }

  /** The deviation guard, over whichever direction the venue was asked in. */
  async #composeWith(
    from: AssetCode,
    to: AssetCode,
    chain: ChainId | undefined,
    ask: () => Promise<PriceQuote>,
  ): Promise<ComposedQuote> {
    if (from === to) {
      throw new ConfigurationError(
        `A same-asset pair needs no quote: ${from} -> ${to} takes the no-swap path`,
        { from, to },
      );
    }

    const executable = await ask();
    const composedAt = this.#clock.now();
    const unguarded =
      chain !== undefined && this.#unguardedTestnetPairs.includes(`${chain}:${from}/${to}`);

    if (unguarded) {
      if (isMainnetChain(chain)) {
        throw new ConfigurationError(`An unguarded quote pair cannot run on mainnet ${chain}`, {
          chain,
          from,
          to,
        });
      }
      const reference: OraclePrice = {
        from,
        to,
        scaledRate: executable.scaledRate,
        source: "testnet-self-reference",
        observedAt: composedAt,
      };
      return { from, to, executable, reference, composedAt };
    }

    const reference = await this.#oracle.reference(from, to);

    guardExecutablePrice(executable, reference, this.#policy, composedAt);

    return { from, to, executable, reference, composedAt };
  }
}
