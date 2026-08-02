import { describe, expect, test } from "bun:test";
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
  serializeMoney,
  subtract,
  sum,
  toDecimalString,
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
    // 1 USDC = 16,000.00 IDRX -> 2.50 USDC = 40,000.00 IDRX
    expect(convert(money(2_500_000n, "USDC"), "IDRX", 1_600_000n)).toEqual(
      money(4_000_000n, "IDRX"),
    );
  });

  test("rejects non-positive rates", () => {
    expect(() => convert(money(1n, "USDC"), "IDRX", 0n)).toThrow(ValidationError);
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
