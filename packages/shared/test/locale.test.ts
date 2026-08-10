import { describe, expect, test } from "bun:test";
import { ValidationError } from "../src/errors.ts";
import { formatMoneyLocale, parseMoneyLocale } from "../src/locale.ts";
import { money } from "../src/money.ts";

describe("formatMoneyLocale", () => {
  test("writes Indonesian amounts the Indonesian way", () => {
    expect(formatMoneyLocale(money(5_043_200n, "IDR"))).toBe("Rp 50.432,00");
    expect(formatMoneyLocale(money(5_000_000n, "IDR"))).toBe("Rp 50.000,00");
    expect(formatMoneyLocale(money(100n, "IDR"))).toBe("Rp 1,00");
    expect(formatMoneyLocale(money(1_234_567_890n, "IDR"))).toBe("Rp 12.345.678,90");
  });

  test("groups from the right, not in fixed blocks", () => {
    expect(formatMoneyLocale(money(100_000n, "IDR"), { symbol: false })).toBe("1.000,00");
    expect(formatMoneyLocale(money(10_000_000n, "IDR"), { symbol: false })).toBe("100.000,00");
  });

  test("trims a fraction that carries no information", () => {
    expect(formatMoneyLocale(money(5_043_200n, "IDR"), { trimZeroFraction: true })).toBe(
      "Rp 50.432",
    );
    expect(formatMoneyLocale(money(5_043_250n, "IDR"), { trimZeroFraction: true })).toBe(
      "Rp 50.432,50",
    );
  });

  test("trailing zeros are dropped past two decimals, losslessly", () => {
    // Six decimals of a stablecoin are the asset's precision, not something a
    // reader needs to count through to find the magnitude.
    expect(formatMoneyLocale(money(12_500_000n, "USDC"), { trimTrailingZeros: true })).toBe(
      "12,50 USDC",
    );
    // Eight significant decimals survive: this is the figure a payer types, so
    // dropping a digit that carries value would tell them to underpay.
    expect(
      formatMoneyLocale(money(4_166_670_000_000_000n, "ETH"), { trimTrailingZeros: true }),
    ).toBe("0,00416667 ETH");
    // Two is the floor — money written as "1" reads as a quantity.
    expect(formatMoneyLocale(money(1_000_000n, "USDC"), { trimTrailingZeros: true })).toBe(
      "1,00 USDC",
    );
    // Grouping is untouched.
    expect(formatMoneyLocale(money(5_043_200n, "IDR"), { trimTrailingZeros: true })).toBe(
      "Rp 50.432,00",
    );
  });

  test("suffixes the code for assets with no conventional symbol", () => {
    expect(formatMoneyLocale(money(5_043_200n, "IDRX"))).toBe("50.432,00 IDRX");
    expect(formatMoneyLocale(money(1_250_000n, "USDC"))).toBe("1,250000 USDC");
  });

  test("keeps every digit of an 18-decimal balance", () => {
    expect(formatMoneyLocale(money(1_000_000_000_000_000_001n, "ETH"), { symbol: false })).toBe(
      "1,000000000000000001",
    );
  });

  test("renders other locales", () => {
    expect(formatMoneyLocale(money(5_043_200n, "IDR"), { locale: "en-US" })).toBe("Rp 50,432.00");
    expect(formatMoneyLocale(money(5_043_200n, "USD"), { locale: "en-US" })).toBe("$ 50,432.00");
  });

  test("keeps the sign outside the symbol", () => {
    expect(formatMoneyLocale(money(-5_043_200n, "IDR"))).toBe("Rp -50.432,00");
  });

  test("renders zero-decimal grouping without a decimal separator", () => {
    expect(formatMoneyLocale(money(5_043_200n, "IDR"), { symbol: false })).toBe("50.432,00");
  });
});

describe("parseMoneyLocale", () => {
  test("reads a dot as a thousands separator", () => {
    expect(parseMoneyLocale("50.432", "IDR")).toEqual(money(5_043_200n, "IDR"));
    expect(parseMoneyLocale("Rp 50.432", "IDR")).toEqual(money(5_043_200n, "IDR"));
    expect(parseMoneyLocale("Rp50.432,50", "IDR")).toEqual(money(5_043_250n, "IDR"));
  });

  test("accepts ungrouped digits", () => {
    expect(parseMoneyLocale("50432", "IDR")).toEqual(money(5_043_200n, "IDR"));
  });

  test("round-trips what it formats", () => {
    for (const amount of [0n, 1n, 100n, 5_043_200n, -5_043_200n, 1_234_567_890n]) {
      const value = money(amount, "IDR");
      expect(parseMoneyLocale(formatMoneyLocale(value), "IDR")).toEqual(value);
    }
  });

  test("strips a trailing asset code", () => {
    expect(parseMoneyLocale("50.432,00 IDRX", "IDRX")).toEqual(money(5_043_200n, "IDRX"));
  });

  test("rejects groups that do not group", () => {
    for (const value of ["50.43", "5.0.432", "50.4321", "1.23.4"]) {
      expect(() => parseMoneyLocale(value, "IDR")).toThrow(ValidationError);
    }
  });

  test("rejects the machine form, which means something else here", () => {
    expect(() => parseMoneyLocale("50432.00", "IDR")).toThrow(ValidationError);
  });

  test("rejects precision the asset cannot hold", () => {
    expect(() => parseMoneyLocale("50.432,123", "IDR")).toThrow(ValidationError);
  });

  test("rejects malformed input", () => {
    for (const value of ["", "abc", "Rp", "1e5", "50,432,00"]) {
      expect(() => parseMoneyLocale(value, "IDR")).toThrow(ValidationError);
    }
  });
});
