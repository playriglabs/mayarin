import { describe, expect, test } from "bun:test";
import { money, ValidationError } from "@mayarin/shared";
import { BasisPointsFeePolicy } from "../src/fees.ts";

describe("BasisPointsFeePolicy", () => {
  test("takes the rate when it is above the floor", () => {
    const policy = new BasisPointsFeePolicy(50, "0.10");

    // 0.5% of 100 USDC is 0.50, above the 0.10 floor.
    expect(policy.feeFor(money(100_000_000n, "USDC"))).toEqual(money(500_000n, "USDC"));
  });

  test("takes the floor when the rate falls below it", () => {
    const policy = new BasisPointsFeePolicy(50, "0.10");

    // 0.5% of 3 USDC is 0.015, below the 0.10 floor.
    expect(policy.feeFor(money(3_000_000n, "USDC"))).toEqual(money(100_000n, "USDC"));
  });

  test("states the floor in the fee's own asset", () => {
    const policy = new BasisPointsFeePolicy(50, "0.10");

    expect(policy.feeFor(money(3_000_000n, "EURC"))).toEqual(money(100_000n, "EURC"));
  });

  test("has no floor unless given one", () => {
    const policy = new BasisPointsFeePolicy(50);

    expect(policy.feeFor(money(3_000_000n, "USDC"))).toEqual(money(15_000n, "USDC"));
  });

  test.each(["0.123", "-1", "abc", ""])("refuses a malformed minimum: %p", (minimum) => {
    expect(() => new BasisPointsFeePolicy(50, minimum)).toThrow(ValidationError);
  });
});
