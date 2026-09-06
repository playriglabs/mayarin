import { describe, expect, test } from "bun:test";
import { RATE_SCALE, scaledRateFrom, unscaleRate, ValidationError } from "@mayarin/shared";
import { invertFxRate, scaleFxRate, splitDecimalRate } from "../src/rates.ts";

describe("splitDecimalRate", () => {
  test("splits a plain decimal into an exact integer pair", () => {
    expect(splitDecimalRate(17635.003032099)).toEqual({
      significand: 17_635_003_032_099n,
      expo: -9,
    });
  });

  test("splits an integer rate", () => {
    expect(splitDecimalRate(17635)).toEqual({ significand: 17_635n, expo: 0 });
  });

  test("splits exponential notation, which toString uses below 1e-6", () => {
    expect(splitDecimalRate(5.67e-7)).toEqual({ significand: 567n, expo: -9 });
  });

  test("round-trips the double exactly", () => {
    const rate = 1.266900222;
    const { significand, expo } = splitDecimalRate(rate);
    expect(Number(significand) * 10 ** expo).toBe(rate);
  });

  test("rejects a non-finite rate", () => {
    expect(() => splitDecimalRate(Number.POSITIVE_INFINITY)).toThrow(ValidationError);
    expect(() => splitDecimalRate(Number.NaN)).toThrow(ValidationError);
  });
});

describe("scaleFxRate", () => {
  test("lifts a rate into minor units of the target asset", () => {
    // 1.2669 of the quote currency per whole base unit, into 6-decimal minor units.
    expect(scaleFxRate(splitDecimalRate(1.2669), 6)).toBe(scaledRateFrom(1_266_900n, 1n));
  });

  test("carries a rate with no fractional part", () => {
    expect(scaleFxRate(splitDecimalRate(2), 6)).toBe(scaledRateFrom(2_000_000n, 1n));
  });

  test("rounds half-up past the rate's nine fractional digits", () => {
    // 1.2345678905 into 0-decimal minor units lands exactly on a half.
    expect(scaleFxRate(splitDecimalRate(1.2345678905), 0)).toBe(1_234_567_891n);
  });
});

describe("invertFxRate", () => {
  test("takes the reciprocal for a series quoted the other way round", () => {
    expect(invertFxRate(splitDecimalRate(2), 6)).toBe(scaledRateFrom(1_000_000n, 2n));
  });

  test("prices rupiah into a 6-decimal dollar stablecoin", () => {
    // 17635.003032099 IDR per USD -> ~56.7 USDC minor units per whole rupiah.
    const scaled = invertFxRate(splitDecimalRate(17635.003032099), 6);
    expect(scaled).toBeGreaterThan(56n * RATE_SCALE);
    expect(scaled).toBeLessThan(57n * RATE_SCALE);
    expect(unscaleRate(scaled)).toBeCloseTo(56.7054, 4);
  });

  test("keeps precision the unscaled integer would drop", () => {
    // The lossy step is `scaledRate` being one integer per whole source unit,
    // not this function: the scaled form still carries the fraction.
    const scaled = invertFxRate(splitDecimalRate(17635.003032099), 6);
    expect(scaled % RATE_SCALE).not.toBe(0n);
  });

  test("refuses to invert a non-positive rate", () => {
    expect(() => invertFxRate({ significand: 0n, expo: 0 }, 6)).toThrow(ValidationError);
    expect(() => invertFxRate({ significand: -1n, expo: 0 }, 6)).toThrow(ValidationError);
  });
});
