import { describe, expect, test } from "bun:test";
import { RATE_SCALE } from "@mayarin/shared";
import { ValidationError } from "../src/errors.ts";
import {
  add,
  compare,
  convert,
  deserializeMoney,
  formatMoney,
  fromDecimalString,
  money,
  multiplyByBasisPoints,
  roundUpToPayerPrecision,
  scaledRateFrom,
  serializeMoney,
  subtract,
  sum,
  toDecimalString,
  unscaleRate,
  zero,
} from "../src/money.ts";

describe("fromDecimalString", () => {
  test("scales to the asset's minor units", () => {
    expect(fromDecimalString("50000", "IDR")).toEqual(money(5_000_000n, "IDR"));
    expect(fromDecimalString("50000.00", "IDR")).toEqual(money(5_000_000n, "IDR"));
    expect(fromDecimalString("1.25", "USDC")).toEqual(money(1_250_000n, "USDC"));
    expect(fromDecimalString("-0.01", "IDR")).toEqual(money(-1n, "IDR"));
  });

  test("keeps full precision for 18-decimal assets", () => {
    expect(fromDecimalString("1.000000000000000001", "ETH")).toEqual(
      money(1_000_000_000_000_000_001n, "ETH"),
    );
  });

  test("rejects precision the asset cannot represent", () => {
    expect(() => fromDecimalString("1.234", "IDR")).toThrow(ValidationError);
  });

  test("rejects malformed input", () => {
    for (const value of ["", "abc", "1.2.3", "1e5", "1,000"]) {
      expect(() => fromDecimalString(value, "IDR")).toThrow(ValidationError);
    }
  });
});

describe("toDecimalString", () => {
  test("round-trips", () => {
    for (const [value, asset] of [
      ["50000.00", "IDR"],
      ["0.000001", "USDC"],
      ["-12.34", "IDR"],
      ["1.000000000000000001", "ETH"],
    ] as const) {
      expect(toDecimalString(fromDecimalString(value, asset))).toBe(value);
    }
  });

  test("pads amounts smaller than one whole unit", () => {
    expect(toDecimalString(money(1n, "IDR"))).toBe("0.01");
    expect(toDecimalString(money(0n, "USDC"))).toBe("0.000000");
  });

  test("formats with the asset code", () => {
    expect(formatMoney(money(5_000_000n, "IDR"))).toBe("50000.00 IDR");
  });
});

describe("arithmetic", () => {
  test("adds and subtracts within an asset", () => {
    expect(add(money(100n, "IDR"), money(25n, "IDR"))).toEqual(money(125n, "IDR"));
    expect(subtract(money(100n, "IDR"), money(25n, "IDR"))).toEqual(money(75n, "IDR"));
  });

  test("refuses to mix assets", () => {
    expect(() => add(money(100n, "IDR"), money(25n, "USDC"))).toThrow(ValidationError);
  });

  test("sums an empty list to zero", () => {
    expect(sum([], "IDR")).toEqual(zero("IDR"));
  });

  test("orders amounts", () => {
    expect(compare(money(1n, "IDR"), money(2n, "IDR"))).toBe(-1);
    expect(compare(money(2n, "IDR"), money(2n, "IDR"))).toBe(0);
    expect(compare(money(3n, "IDR"), money(2n, "IDR"))).toBe(1);
  });
});

describe("multiplyByBasisPoints", () => {
  test("applies a percentage rate", () => {
    // 0.50% of 50,000.00 IDR = 250.00 IDR
    expect(multiplyByBasisPoints(money(5_000_000n, "IDR"), 50)).toEqual(money(25_000n, "IDR"));
  });

  test("rounds half up by default", () => {
    // 0.50% of 1.01 IDR = 0.505 minor units -> 1
    expect(multiplyByBasisPoints(money(101n, "IDR"), 50)).toEqual(money(1n, "IDR"));
    // 0.49% of 1.01 IDR = 0.4949 minor units -> 0
    expect(multiplyByBasisPoints(money(101n, "IDR"), 49)).toEqual(money(0n, "IDR"));
  });

  test("supports explicit rounding modes", () => {
    expect(multiplyByBasisPoints(money(101n, "IDR"), 49, "up")).toEqual(money(1n, "IDR"));
    expect(multiplyByBasisPoints(money(101n, "IDR"), 50, "down")).toEqual(money(0n, "IDR"));
  });

  test("rejects negative rates", () => {
    expect(() => multiplyByBasisPoints(money(100n, "IDR"), -1)).toThrow(ValidationError);
  });

  test("never loses value: fee plus net equals gross", () => {
    for (const gross of [1n, 7n, 999n, 123_456_789n]) {
      const total = money(gross, "IDR");
      const fee = multiplyByBasisPoints(total, 50);
      expect(add(fee, subtract(total, fee))).toEqual(total);
    }
  });
});

describe("convert", () => {
  test("uses target minor units per whole source unit", () => {
    // 1 USDC = 16,000.00 IDR -> 2.50 USDC = 40,000.00 IDR
    expect(convert(money(2_500_000n, "USDC"), "IDR", 1_600_000n * RATE_SCALE)).toEqual(
      money(4_000_000n, "IDR"),
    );
  });

  test("rejects non-positive rates", () => {
    expect(() => convert(money(1n, "USDC"), "IDR", 0n)).toThrow(ValidationError);
  });
});

describe("serialization", () => {
  test("round-trips through the wire shape", () => {
    const value = money(1_000_000_000_000_000_001n, "ETH");
    expect(serializeMoney(value)).toEqual({ amount: "1000000000000000001", asset: "ETH" });
    expect(deserializeMoney(serializeMoney(value))).toEqual(value);
  });

  test("rejects unknown assets", () => {
    expect(() => deserializeMoney({ amount: "1", asset: "XYZ" as never })).toThrow(ValidationError);
  });
});

describe("rate precision (#90)", () => {
  test("a rate too small to survive as an integer keeps its value", () => {
    // IDR into 6-decimal USDC lands near 56 minor units per rupiah. As one
    // integer per whole source unit that rounded to 56, costing ~19 bps —
    // more than a third of the 50 bps fee — on every IDR-priced payment.
    const exact = 56.105526488;
    const scaled = scaledRateFrom(56_105_526_488n, RATE_SCALE);

    expect(unscaleRate(scaled)).toBeCloseTo(exact, 9);
  });

  test("the error it leaves is below a hundredth of a basis point", () => {
    const scaled = 56_105_526_488n;
    const priced = convert(money(50_000_00n, "IDR"), "USDC", scaled);
    const exact = 50_000 * 56.105526488;

    const bps = (Math.abs(Number(priced.amount) - exact) / exact) * 10_000;
    expect(bps).toBeLessThan(0.01);
  });

  test("the same price under a whole-unit integer rate is ~19 bps out", () => {
    // Pins what the change fixed, so a regression to integer rates is visible
    // as a number rather than as a vague loss of precision.
    const priced = convert(money(50_000_00n, "IDR"), "USDC", 56n * RATE_SCALE);
    const exact = 50_000 * 56.105526488;

    const bps = (Math.abs(Number(priced.amount) - exact) / exact) * 10_000;
    expect(bps).toBeGreaterThan(18);
  });

  test("a high-value pair is unaffected either way", () => {
    const scaled = 3_700_000_000n * RATE_SCALE;
    expect(convert(money(10n ** 18n, "ETH"), "USDC", scaled)).toEqual(
      money(3_700_000_000n, "USDC"),
    );
  });

  test("scaledRateFrom rounds down when asked, so a venue rate is never optimistic", () => {
    expect(scaledRateFrom(10n, 3n, "down")).toBe(3_333_333_333n);
    expect(scaledRateFrom(10n, 3n)).toBe(3_333_333_333n);
    expect(scaledRateFrom(20n, 3n, "down")).toBe(6_666_666_666n);
    expect(scaledRateFrom(20n, 3n)).toBe(6_666_666_667n);
  });

  test("refuses a non-positive denominator rather than dividing by zero", () => {
    expect(() => scaledRateFrom(1n, 0n)).toThrow(ValidationError);
    expect(() => scaledRateFrom(1n, -1n)).toThrow(ValidationError);
  });
});

describe("roundUpToPayerPrecision", () => {
  test("rounds an ETH amount up to the eight decimals a wallet accepts", () => {
    // 0.004166666666666663 ETH — the exact conversion, and a figure no payer
    // enters correctly into a wallet field that stops at eight.
    const exact = money(4_166_666_666_666_663n, "ETH");
    expect(toDecimalString(roundUpToPayerPrecision(exact))).toBe("0.004166670000000000");
  });

  test("rounds up, never down — a short deposit never funds", () => {
    const exact = money(4_166_666_666_666_663n, "ETH");
    // Funding needs the confirmed total to *reach* what is owed, so the rounded
    // figure must never be less than the amount actually required.
    expect(roundUpToPayerPrecision(exact).amount).toBeGreaterThan(exact.amount);
  });

  test("leaves an amount already at the payer's precision alone", () => {
    const round = money(4_166_670_000_000_000n, "ETH");
    expect(roundUpToPayerPrecision(round)).toEqual(round);
  });

  test("is the identity for assets whose own precision is already payable", () => {
    // USDC's six decimals and IDR's two are figures a payer can type as they
    // are, so nothing is rounded and no dust is asked for.
    const usdc = money(12_500_000n, "USDC");
    expect(roundUpToPayerPrecision(usdc)).toEqual(usdc);
    const idr = money(5_043_217n, "IDR");
    expect(roundUpToPayerPrecision(idr)).toEqual(idr);
  });
});
