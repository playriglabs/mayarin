import { describe, expect, test } from "bun:test";
import { scaledRateFrom, ValidationError } from "@mayarin/shared";
import { scaleTickerPrice, splitDecimalPrice } from "../src/ticker.ts";

describe("splitDecimalPrice", () => {
  test("splits a decimal string into an exact integer pair", () => {
    expect(splitDecimalPrice("2455.32")).toEqual({ significand: 245_532n, expo: -2 });
  });

  test("splits an integer price", () => {
    expect(splitDecimalPrice("2455")).toEqual({ significand: 2_455n, expo: 0 });
  });

  test("splits a sub-unit price without losing digits", () => {
    expect(splitDecimalPrice("0.13221")).toEqual({ significand: 13_221n, expo: -5 });
  });

  test("keeps more digits than a double could hold", () => {
    // 25 significant digits: a Number round-trip would quantise this.
    const { significand, expo } = splitDecimalPrice("1234567890123456789.012345");
    expect(significand).toBe(1_234_567_890_123_456_789_012_345n);
    expect(expo).toBe(-6);
  });

  test("rejects a negative price", () => {
    expect(() => splitDecimalPrice("-1.5")).toThrow(ValidationError);
  });

  test("rejects exponential notation rather than guessing at it", () => {
    expect(() => splitDecimalPrice("1e-7")).toThrow(ValidationError);
  });

  test("rejects a non-numeric body", () => {
    expect(() => splitDecimalPrice("")).toThrow(ValidationError);
    expect(() => splitDecimalPrice("null")).toThrow(ValidationError);
  });
});

describe("scaleTickerPrice", () => {
  test("lifts a price into minor units of the settlement asset", () => {
    // 2455.32 dollars per ETH, into 6-decimal USDC minor units.
    expect(scaleTickerPrice(splitDecimalPrice("2455.32"), 6)).toBe(
      scaledRateFrom(2_455_320_000n, 1n),
    );
  });

  test("prices a sub-dollar asset without collapsing to zero", () => {
    // ARB at 0.13221 -> 132 210 minor USDC per whole ARB.
    expect(scaleTickerPrice(splitDecimalPrice("0.13221"), 6)).toBe(scaledRateFrom(132_210n, 1n));
  });

  test("rounds half-up past the rate's nine fractional digits", () => {
    // A 0-decimal target forces the division: .5 rounds away from zero.
    expect(scaleTickerPrice(splitDecimalPrice("1.2345678905"), 0)).toBe(1_234_567_891n);
  });
});
