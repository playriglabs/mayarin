/**
 * Rate provider port.
 *
 * Phase 1 locks prices against a configured table. Phase 2's liquidity router
 * implements the same interface with real price discovery across DEX and
 * aggregator sources, so the clearing engine does not change.
 */

import {
  type AssetCode,
  assetDecimals,
  ConfigurationError,
  type Money,
  RATE_SCALE,
} from "@mayarin/shared";
import type { LockedRate } from "./types.ts";

export interface RateQuote {
  readonly from: AssetCode;
  readonly to: AssetCode;
  /** Minor units of `to` per one whole unit of `from`. */
  readonly scaledRate: bigint;
  readonly source: string;
  readonly expiresAt?: Date;
}

export interface RateProvider {
  /**
   * Quotes a conversion. `amount` is passed so size-aware sources (an AMM, an
   * aggregator) can price slippage; Phase 1's static provider ignores it.
   */
  quote(from: AssetCode, to: AssetCode, amount: Money): Promise<RateQuote>;
}

/**
 * Fixed-table rate provider.
 *
 * Same-asset conversions are the identity rate, so a deployment that clears
 * IDR into IDRX 1:1 needs no configuration at all.
 */
export class StaticRateProvider implements RateProvider {
  readonly #rates: ReadonlyMap<string, bigint>;
  readonly #source: string;

  constructor(rates: Readonly<Record<string, bigint>> = {}, source = "static") {
    this.#rates = new Map(Object.entries(rates));
    this.#source = source;
  }

  async quote(from: AssetCode, to: AssetCode, _amount: Money): Promise<RateQuote> {
    return {
      from,
      to,
      // Configured in the readable whole-unit form, like `EXCHANGE_RATES`.
      scaledRate: this.#rateFor(from, to) * RATE_SCALE,
      source: this.#source,
    };
  }

  #rateFor(from: AssetCode, to: AssetCode): bigint {
    const configured = this.#rates.get(rateKey(from, to));
    if (configured !== undefined) return configured;

    // Identity: one whole unit of `from` is one whole unit of `to`.
    if (from === to) return 10n ** BigInt(assetDecimals(to));

    throw new ConfigurationError(`No rate configured for ${from} -> ${to}`, { from, to });
  }
}

export function rateKey(from: AssetCode, to: AssetCode): string {
  return `${from}/${to}`;
}

export function lockRate(quote: RateQuote, now: Date): LockedRate {
  return {
    from: quote.from,
    to: quote.to,
    scaledRate: quote.scaledRate,
    source: quote.source,
    lockedAt: new Date(now),
    ...(quote.expiresAt === undefined ? {} : { expiresAt: new Date(quote.expiresAt) }),
  };
}
