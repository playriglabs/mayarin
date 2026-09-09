import { describe, expect, test } from "bun:test";
import { formatAmountInput, isValidAmount, normalizeAmountInput } from "./pricing";

describe("localized currency input", () => {
  test("groups canonical amounts without converting them to numbers", () => {
    expect(formatAmountInput("15000.99")).toBe("15.000,99");
    expect(formatAmountInput("12345678901234567890.10")).toBe("12.345.678.901.234.567.890,10");
  });

  test("normalizes Indonesian input for the API", () => {
    expect(normalizeAmountInput("15.000,99", "IDR")).toBe("15000.99");
    expect(normalizeAmountInput("50000.99", "IDR")).toBe("50000.99");
    expect(normalizeAmountInput("Rp 15.000,99", "IDR")).toBeUndefined();
  });

  test("rejects precision beyond the currency registry", () => {
    expect(normalizeAmountInput("15.000,999", "IDR")).toBeUndefined();
    expect(isValidAmount("15000.99", "IDR")).toBe(true);
    expect(isValidAmount("15000.999", "IDR")).toBe(false);
  });

  test("keeps incomplete decimals editable but not submittable", () => {
    expect(normalizeAmountInput("15.000,", "IDR")).toBe("15000.");
    expect(formatAmountInput("15000.")).toBe("15.000,");
    expect(isValidAmount("15000.", "IDR")).toBe(false);
  });

  test("accepts grouped whole amounts and refuses fractions for JPY and VND", () => {
    expect(normalizeAmountInput("5.000", "JPY")).toBe("5000");
    expect(normalizeAmountInput("250.000", "VND")).toBe("250000");
    expect(normalizeAmountInput("5.000,50", "JPY")).toBeUndefined();
    expect(isValidAmount("5000", "JPY")).toBe(true);
    expect(isValidAmount("5000.50", "JPY")).toBe(false);
  });
});
