/**
 * FX rates wire format and pure rate scaling.
 *
 * The FX API serves a decimal rate per currency against a base — `USD -> IDR`
 * is `17635.003032099` rupiah per dollar. Everything in this file is pure: the
 * response schema, the decimal-to-integer lift, and the arithmetic that puts a
 * rate into the codebase's minor-units-per-whole-unit shape. The network call
 * lives in `adapter.ts`.
 *
 * **A float never reaches a calculation.** JSON has one number type, so a rate
 * arrives as a double no matter what we do; it is turned straight into an exact
 * `significand × 10^expo` pair by reading its shortest round-tripping decimal
 * form, and every step after that is BigInt. This mirrors the Pyth adapter,
 * which receives the same shape already split.
 */

import { scaledRateFrom, ValidationError } from "@mayarin/shared";
import { z } from "zod";

export const fxLatestResponseSchema = z.object({
  success: z.boolean().optional(),
  /** Unix seconds at which the provider observed the rates. */
  timestamp: z.number().int(),
  base: z.string(),
  rates: z.record(z.string(), z.number()),
});

export type FxLatestResponse = z.infer<typeof fxLatestResponseSchema>;

/** A decimal rate split into the exact integer pair `significand × 10^expo`. */
export interface DecimalRate {
  readonly significand: bigint;
  readonly expo: number;
}

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/**
 * Splits a decimal rate into `significand × 10^expo`, exactly.
 *
 * The input is the double's shortest round-tripping decimal form, which is what
 * `Number.prototype.toString` produces — so `17635.003032099` becomes
 * `17635003032099 × 10^-9` with no rounding of its own. Exponential notation is
 * accepted because `toString` switches to it below `1e-6`, which a rate against
 * a low-value currency can reach.
 */
export function splitDecimalRate(rate: number): DecimalRate {
  if (!Number.isFinite(rate)) {
    throw new ValidationError("An FX rate must be a finite number", { rate: String(rate) });
  }

  const match = DECIMAL_PATTERN.exec(rate.toString());
  if (match === null) {
    throw new ValidationError("An FX rate is not a decimal number", { rate: rate.toString() });
  }

  const [, sign, whole = "", fraction = "", exponent] = match;
  const significand = BigInt(`${sign === "-" ? "-" : ""}${whole}${fraction}`);
  const expo = (exponent === undefined ? 0 : Number.parseInt(exponent, 10)) - fraction.length;
  return { significand, expo };
}

/**
 * Lifts a rate quoted in the pair's own direction into minor units of `to` per
 * whole unit of `from`: `significand × 10^(expo + decimals(to))`, in BigInt. A
 * negative net exponent divides half-up — the reference feeds a deviation
 * guard, so nearest-value is the honest representation.
 */
export function scaleFxRate(rate: DecimalRate, toDecimals: number): bigint {
  const shift = rate.expo + toDecimals;
  return shift >= 0
    ? scaledRateFrom(rate.significand * 10n ** BigInt(shift), 1n)
    : scaledRateFrom(rate.significand, 10n ** BigInt(-shift));
}

/**
 * The same lift for a rate quoted the other way round.
 *
 * The API publishes rates against a base currency, so `USD/IDR` gives rupiah
 * per dollar and there is no reverse series. Pricing an IDR-denominated
 * merchant into a dollar stablecoin needs dollars per rupiah, so the reciprocal
 * is taken here rather than asking for a series that does not exist:
 *
 * ```
 * minor(to) per whole(from) = 10^(decimals(to) − expo) ÷ significand
 * ```
 *
 * Half-up, matching `scaleFxRate`.
 *
 * **This is lossy in a way the forward direction is not**, for exactly the
 * reason `invertPythPrice` documents: `scaledRate` is one integer per whole
 * source unit, so `IDR -> USDC` lands near 57 minor units per rupiah and
 * carries roughly `0.5 / rate` of error — under 1%, but larger than the fee.
 * The loss is in the rate representation, not in this function.
 */
export function invertFxRate(rate: DecimalRate, toDecimals: number): bigint {
  if (rate.significand <= 0n) {
    throw new ValidationError("Cannot invert a non-positive FX rate", {
      significand: rate.significand.toString(),
    });
  }

  const shift = toDecimals - rate.expo;
  return shift >= 0
    ? scaledRateFrom(10n ** BigInt(shift), rate.significand)
    : scaledRateFrom(1n, rate.significand * 10n ** BigInt(-shift));
}
