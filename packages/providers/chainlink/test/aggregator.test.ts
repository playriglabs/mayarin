import { describe, expect, test } from "bun:test";
import { isMayarinError, ProviderError } from "@mayarin/shared";
import { assertUsableRound, scaleAnswer } from "../src/aggregator.ts";

describe("scaleAnswer", () => {
  test("a feed with more decimals than the target divides half-up", () => {
    // 8-dp feed into 6-dp USDC: shift -2. 123.45 -> 123, 123.55 -> 124.
    expect(scaleAnswer(12_345n, 8, 6)).toBe(123n);
    expect(scaleAnswer(12_355n, 8, 6)).toBe(124n);
  });

  test("matching decimals pass the answer through", () => {
    expect(scaleAnswer(370_000_000_000n, 6, 6)).toBe(370_000_000_000n);
  });

  test("a feed with fewer decimals than the target multiplies exactly", () => {
    // 3700 USD at 2-dp feed into 6-dp minor units: ×10^4.
    expect(scaleAnswer(370_000n, 2, 6)).toBe(3_700_000_000n);
  });

  test("a typical ETH/USD read: 8-dp feed into 6-dp minor units", () => {
    expect(scaleAnswer(370_000_000_000n, 8, 6)).toBe(3_700_000_000n);
  });
});

describe("assertUsableRound", () => {
  test("a completed round with a positive answer passes", () => {
    expect(() =>
      assertUsableRound({ answer: 370_000_000_000n, updatedAt: 1_785_915_000n }, "ETH", "USDC"),
    ).not.toThrow();
  });

  test("an incomplete round (updatedAt zero) is a retryable ProviderError", () => {
    try {
      assertUsableRound({ answer: 370_000_000_000n, updatedAt: 0n }, "ETH", "USDC");
      throw new Error("expected assertUsableRound to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.retryable).toBe(true);
    }
  });

  test("a non-positive answer is a ProviderError", () => {
    expect(() =>
      assertUsableRound({ answer: 0n, updatedAt: 1_785_915_000n }, "ETH", "USDC"),
    ).toThrow(ProviderError);
    expect(() =>
      assertUsableRound({ answer: -1n, updatedAt: 1_785_915_000n }, "ETH", "USDC"),
    ).toThrow(ProviderError);
  });

  test("an incomplete round is reported before the answer is judged", () => {
    // Both defects at once: the incomplete-round signal wins, matching the
    // guard's stale-before-deviation ordering.
    try {
      assertUsableRound({ answer: -1n, updatedAt: 0n }, "ETH", "USDC");
      throw new Error("expected assertUsableRound to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.message).toContain("never completed");
    }
  });
});
