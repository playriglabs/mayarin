/**
 * Coinbase ticker wire format and pure price scaling.
 *
 * The Exchange ticker serves the last trade on a product, with its price as a
 * **decimal string** and its time as an ISO instant. Everything here is pure:
 * the response schema, the exact split of that string into an integer pair, and
 * the arithmetic that lifts it into the codebase's minor-units-per-whole-unit
 * rate shape. The network call lives in `adapter.ts`.
 *
 * A string price is the reason this adapter never touches a float at all — not
 * even in transport, which is the one place the Pyth and FX adapters cannot
 * avoid. `"2455.32"` is split as written.
 */

import { scaledRateFrom, ValidationError } from "@mayarin/shared";
import { z } from "zod";

export const coinbaseTickerSchema = z.object({
  /** Last trade price, a decimal string: `"2455.32"`. */
  price: z.string(),
  /** ISO instant of that trade. */
  time: z.string(),
});

export type CoinbaseTicker = z.infer<typeof coinbaseTickerSchema>;

/** A decimal price split into the exact integer pair `significand × 10^expo`. */
export interface DecimalPrice {
  readonly significand: bigint;
  readonly expo: number;
}

const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

/**
 * Splits a decimal price string into `significand × 10^expo`, exactly.
 *
 * No `Number` is constructed on the way, so a price with more digits than a
 * double can hold loses nothing. Negative and exponential forms are rejected
 * rather than handled: a spot price is neither, and accepting a shape the
 * venue never sends would only hide a response we do not understand.
 */
export function splitDecimalPrice(text: string): DecimalPrice {
  const match = DECIMAL_PATTERN.exec(text);
  if (match === null) {
    throw new ValidationError("A Coinbase price is not a positive decimal", { price: text });
  }

  const [, whole = "", fraction = ""] = match;
  // `-fraction.length` would be `-0` for an integer price, which is a distinct
  // value that leaks into diagnostics and equality checks for no reason.
  return {
    significand: BigInt(`${whole}${fraction}`),
    expo: fraction.length === 0 ? 0 : -fraction.length,
  };
}

/**
 * Lifts a price into minor units of `to` per whole unit of `from`:
 * `significand × 10^(expo + decimals(to))`, in BigInt. A negative net exponent
 * divides half-up — the reference feeds a deviation guard, so nearest-value is
 * the honest representation.
 */
export function scaleTickerPrice(price: DecimalPrice, toDecimals: number): bigint {
  const shift = price.expo + toDecimals;
  return shift >= 0
    ? scaledRateFrom(price.significand * 10n ** BigInt(shift), 1n)
    : scaledRateFrom(price.significand, 10n ** BigInt(-shift));
}
