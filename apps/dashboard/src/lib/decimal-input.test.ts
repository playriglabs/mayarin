import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import { money } from "@mayarin/shared/money";
import { fromEditableDecimalString } from "./decimal-input";

describe("editable decimal input", () => {
  test("accepts dot and comma as the decimal separator", () => {
    expect(fromEditableDecimalString("12.315111", "USDC")).toEqual(money(12_315_111n, "USDC"));
    expect(fromEditableDecimalString("12,315111", "USDC")).toEqual(money(12_315_111n, "USDC"));
  });

  test("keeps eighteen-decimal amounts exact", () => {
    expect(fromEditableDecimalString("1,000000000000000001", "ETH")).toEqual(
      money(1_000_000_000_000_000_001n, "ETH"),
    );
  });

  test("rejects grouping, mixed separators and excess precision", () => {
    for (const value of ["1,000,000", "1.000,00", "12,3151111"]) {
      expect(() => fromEditableDecimalString(value, "USDC")).toThrow(ValidationError);
    }
  });
});
