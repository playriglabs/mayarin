/**
 * Hermes wire format and pure price scaling.
 *
 * Hermes (Pyth's price service) serves the latest signed price update per
 * feed. Everything in this file is pure — the response schema and the integer
 * arithmetic that lifts Pyth's `price × 10^expo` representation into the
 * codebase's minor-units-per-whole-unit rate shape. The network call lives in
 * `adapter.ts`.
 */

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
