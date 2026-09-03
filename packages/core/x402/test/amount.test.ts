import { describe, expect, test } from "bun:test";
import { money, ValidationError } from "@mayarin/shared";
import {
  parseAtomicAmount,
  parseUnixSeconds,
  toAtomicAmount,
  toUnixSeconds,
} from "../src/amount.ts";

describe("parseAtomicAmount", () => {
  test("reads atomic units into Money without going through a number", () => {
    expect(parseAtomicAmount("10000", "USDC")).toEqual(money(10_000n, "USDC"));
  });

  // An 18-decimal balance exceeds Number.MAX_SAFE_INTEGER by orders of
  // magnitude. The point of the string on the wire is that it survives, and a
  // parser that detoured through a float would round the low digits away
  // silently.
  test("survives an amount no double could hold", () => {
    const wei = "123456789012345678901";

    expect(parseAtomicAmount(wei, "ETH").amount).toBe(123_456_789_012_345_678_901n);
  });

  // BigInt is dangerously permissive: BigInt("") is 0n and BigInt("0x10") is
  // 16n. Either would turn a malformed payment into a wrong amount rather than
  // a rejected one.
  test.each([
    ["the empty string", ""],
    ["a hex prefix", "0x10"],
    ["a decimal point", "1.5"],
    ["a leading plus", "+10"],
    ["a negative", "-10"],
    ["whitespace", " 10 "],
    ["a thousands separator", "10,000"],
    ["scientific notation", "1e4"],
  ])("rejects %s rather than coercing it", (_label, value) => {
    expect(() => parseAtomicAmount(value, "USDC")).toThrow(ValidationError);
  });
});

describe("toAtomicAmount", () => {
  test("round-trips through the wire form", () => {
    const value = money(999_999_999_999_999_999n, "ETH");

    expect(parseAtomicAmount(toAtomicAmount(value), "ETH")).toEqual(value);
  });

  test("refuses a negative amount, which the wire cannot express", () => {
    expect(() => toAtomicAmount(money(-1n, "USDC"))).toThrow(ValidationError);
  });
});

describe("Unix seconds", () => {
  test("round-trips an instant to the second", () => {
    expect(parseUnixSeconds(toUnixSeconds(new Date(1_740_672_089_000)), "validAfter")).toBe(
      1_740_672_089n,
    );
  });

  test("truncates rather than rounds, so a deadline never moves forward", () => {
    expect(toUnixSeconds(new Date(1_740_672_089_999))).toBe("1740672089");
  });

  test("names the field it rejected", () => {
    expect(() => parseUnixSeconds("later", "validBefore")).toThrow(/validBefore/);
  });
});
