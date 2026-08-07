import { describe, expect, test } from "bun:test";
import { ConfigurationError, isMayarinError, ProviderError } from "@mayarin/shared";
import type { DeviationPolicy, ExecutablePrice, OraclePrice } from "../src/oracle.ts";
import { assertFresh, assertWithinDeviation, guardExecutablePrice } from "../src/oracle.ts";
import { FixedPriceOracle } from "../testing/index.ts";

const NOW = new Date("2026-08-05T10:00:00.000Z");

function reference(overrides: Partial<OraclePrice> = {}): OraclePrice {
  return {
    from: "ETH",
    to: "USDC",
    scaledRate: 3_700_000_000n,
    source: "pyth",
    observedAt: NOW,
    ...overrides,
  };
}

function executable(overrides: Partial<ExecutablePrice> = {}): ExecutablePrice {
  return {
    from: "ETH",
    to: "USDC",
    scaledRate: 3_700_000_000n,
    source: "dex",
    ...overrides,
  };
}

describe("PriceOracle port", () => {
  test("serves the configured reference for a pair", async () => {
    const oracle = new FixedPriceOracle([reference()]);
    const price = await oracle.reference("ETH", "USDC");

    expect(price.scaledRate).toBe(3_700_000_000n);
    expect(price.source).toBe("pyth");
    expect(price.observedAt).toEqual(NOW);
  });

  test("a pair the oracle cannot serve throws ConfigurationError", async () => {
    const oracle = new FixedPriceOracle([reference()]);

    expect(oracle.reference("USDC", "ETH")).rejects.toThrow(ConfigurationError);
  });

  test("the reverse pair is a separate observation — no symmetry inference", async () => {
    const oracle = new FixedPriceOracle([
      reference(),
      reference({ from: "USDC", to: "ETH", scaledRate: 270_000_000_000_000n }),
    ]);

    const forward = await oracle.reference("ETH", "USDC");
    const back = await oracle.reference("USDC", "ETH");
    expect(forward.scaledRate).not.toBe(back.scaledRate);
  });
});

describe("assertFresh", () => {
  test("accepts an observation younger than the limit", () => {
    const observed = new Date(NOW.getTime() - 4_000);
    expect(() => assertFresh(reference({ observedAt: observed }), 5_000, NOW)).not.toThrow();
  });

  test("accepts an observation exactly at the limit", () => {
    const observed = new Date(NOW.getTime() - 5_000);
    expect(() => assertFresh(reference({ observedAt: observed }), 5_000, NOW)).not.toThrow();
  });

  test("rejects an observation older than the limit", () => {
    const observed = new Date(NOW.getTime() - 5_001);
    expect(() => assertFresh(reference({ observedAt: observed }), 5_000, NOW)).toThrow(
      ProviderError,
    );
  });

  test("a future-dated observation counts as fresh — clock skew is not staleness", () => {
    const observed = new Date(NOW.getTime() + 60_000);
    expect(() => assertFresh(reference({ observedAt: observed }), 5_000, NOW)).not.toThrow();
  });

  test("staleness is retryable — a later attempt may see a fresher price", () => {
    const observed = new Date(NOW.getTime() - 10_000);
    try {
      assertFresh(reference({ observedAt: observed }), 5_000, NOW);
      throw new Error("expected assertFresh to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.retryable).toBe(true);
    }
  });
});

describe("assertWithinDeviation", () => {
  test("an executable price equal to the reference passes", () => {
    expect(() => assertWithinDeviation(executable(), reference(), 50)).not.toThrow();
  });

  test("a deviation of exactly the limit passes — the bound is inclusive", () => {
    // 50 bps of 10_000 is exactly 50.
    const ref = reference({ scaledRate: 10_000n });
    expect(() => assertWithinDeviation(executable({ scaledRate: 10_050n }), ref, 50)).not.toThrow();
    expect(() => assertWithinDeviation(executable({ scaledRate: 9_950n }), ref, 50)).not.toThrow();
  });

  test("one minor unit beyond the limit rejects, in either direction", () => {
    const ref = reference({ scaledRate: 10_000n });
    expect(() => assertWithinDeviation(executable({ scaledRate: 10_051n }), ref, 50)).toThrow(
      ProviderError,
    );
    expect(() => assertWithinDeviation(executable({ scaledRate: 9_949n }), ref, 50)).toThrow(
      ProviderError,
    );
  });

  test("the comparison is exact — no rounding hides a sub-bps overshoot", () => {
    // Allowed difference is 50 bps of 10_001 = 50.005 exactly; 51 exceeds it
    // even though floor(51 * 10_000 / 10_001) is still 50 bps.
    const ref = reference({ scaledRate: 10_001n });
    expect(() => assertWithinDeviation(executable({ scaledRate: 10_052n }), ref, 50)).toThrow(
      ProviderError,
    );
  });

  test("a pair mismatch is a wiring bug, not a market condition", () => {
    expect(() => assertWithinDeviation(executable({ to: "USDT" }), reference(), 50)).toThrow(
      ConfigurationError,
    );
  });

  test("a non-positive reference rate is a wiring bug", () => {
    expect(() => assertWithinDeviation(executable(), reference({ scaledRate: 0n }), 50)).toThrow(
      ConfigurationError,
    );
  });
});

describe("guardExecutablePrice", () => {
  const policy: DeviationPolicy = { maxDeviationBps: 50, maxAgeMs: 5_000 };

  test("a fresh reference within the bound passes", () => {
    expect(() => guardExecutablePrice(executable(), reference(), policy, NOW)).not.toThrow();
  });

  test("freshness is checked before deviation — a stale reference never vouches", () => {
    const stale = reference({
      observedAt: new Date(NOW.getTime() - 60_000),
      // Deviation would also fail; the error must still be the staleness one.
      scaledRate: 1n,
    });
    try {
      guardExecutablePrice(executable(), stale, policy, NOW);
      throw new Error("expected guardExecutablePrice to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.message).toContain("stale");
    }
  });

  test("a deviated executable price fails the guard", () => {
    const drifted = executable({ scaledRate: 3_900_000_000n });
    expect(() => guardExecutablePrice(drifted, reference(), policy, NOW)).toThrow(ProviderError);
  });
});
