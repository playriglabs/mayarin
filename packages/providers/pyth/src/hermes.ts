/**
 * Hermes wire format and pure price scaling.
 *
 * Hermes (Pyth's price service) serves the latest signed price update per
 * feed. Everything in this file is pure — the response schema and the integer
 * arithmetic that lifts Pyth's `price × 10^expo` representation into the
 * codebase's minor-units-per-whole-unit rate shape. The network call lives in
 * `adapter.ts`.
 */

import { ValidationError } from "@mayarin/shared";
import { z } from "zod";

export const hermesPriceSchema = z.object({
  /** Integer significand as a decimal string, scaled by 10^expo. */
  price: z.string().regex(/^-?\d+$/),
  /** Confidence interval, same scaling. Unused today; parsed for forward use. */
  conf: z.string().regex(/^\d+$/),
  expo: z.number().int(),
  /** Unix seconds at which Pyth published the aggregate. */
  publish_time: z.number().int(),
});

export const hermesLatestResponseSchema = z.object({
  parsed: z.array(
    z.object({
      /** Feed id as unprefixed lowercase hex. */
      id: z.string(),
      price: hermesPriceSchema,
    }),
  ),
});

export type HermesLatestResponse = z.infer<typeof hermesLatestResponseSchema>;

/** Feed ids compare as unprefixed lowercase hex, however they were configured. */
export function normalizeFeedId(id: string): string {
  return (id.startsWith("0x") || id.startsWith("0X") ? id.slice(2) : id).toLowerCase();
}

/**
 * Lifts a Pyth price (`significand × 10^expo` units of the quote currency per
 * whole base unit) into minor units of `to` per whole unit of `from`:
 * `significand × 10^(expo + decimals(to))`, computed entirely in BigInt. A
 * negative net exponent divides half-up — the reference feeds a deviation
 * guard, so nearest-value is the honest representation, and sub-minor-unit
 * precision carries no information the guard can use.
 */
export function scalePythPrice(significand: bigint, expo: number, toDecimals: number): bigint {
  const shift = expo + toDecimals;
  if (shift >= 0) return significand * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  const half = divisor / 2n;
  return (significand + half) / divisor;
}

/**
 * The same lift for a feed quoted the other way round.
 *
 * Pyth publishes `FX.USD/IDR` — rupiah per dollar — and nothing for the reverse.
 * Pricing an IDR-denominated merchant into a dollar stablecoin needs dollars per
 * rupiah, so the reciprocal is taken here rather than asking for a feed that
 * does not exist:
 *
 * ```
 * minor(to) per whole(from) = 10^(decimals(to) − expo) ÷ significand
 * ```
 *
 * Half-up, matching `scalePythPrice`.
 *
 * **This is lossy in a way the forward direction is not.** A reciprocal small
 * enough to quantise coarsely — `IDR → USDC` lands near 62.5 minor units per
 * rupiah — carries an error of roughly `0.5 / rate`, which for IDR is ~0.8%:
 * larger than the 50 bps fee. The loss is in the rate representation
 * (`minorUnitsPerWholeUnit`, one integer per whole source unit), not in this
 * function, and inverting is what makes it reachable rather than what causes it.
 * `quantisationBps` reports it so a caller can refuse a rate too coarse to price
 * with.
 */
export function invertPythPrice(significand: bigint, expo: number, toDecimals: number): bigint {
  if (significand <= 0n) {
    throw new ValidationError("Cannot invert a non-positive Pyth price", {
      significand: significand.toString(),
    });
  }

  const shift = toDecimals - expo;
  if (shift >= 0) {
    const numerator = 10n ** BigInt(shift);
    return (numerator + significand / 2n) / significand;
  }

  // A feed whose exponent exceeds the target's decimals: the reciprocal is
  // smaller than one minor unit before rounding, so scale the denominator up.
  const denominator = significand * 10n ** BigInt(-shift);
  return (1n + denominator / 2n) / denominator;
}

/**
 * How much precision an integer rate lost, in basis points.
 *
 * `minorUnitsPerWholeUnit` is one integer per whole source unit, so a rate near
 * 62 quantises ~100× more coarsely than one near 6200. For a source currency
 * whose whole unit is worth very little — rupiah against a dollar stablecoin —
 * that error can exceed the fee, and it is silent unless something measures it.
 */
export function quantisationBps(exact: number, rounded: bigint): number {
  if (exact <= 0) return 0;
  return (Math.abs(Number(rounded) - exact) / exact) * 10_000;
}
