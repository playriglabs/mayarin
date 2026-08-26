import { describe, expect, test } from "bun:test";
import type { OraclePrice, PriceQuote } from "@mayarin/clearing";
import { ConfigurationError, money, RATE_SCALE, ValidationError } from "@mayarin/shared";
import type { ComposedQuote } from "../src/engine.ts";
import { isExpired, type LockTerms, lockQuote } from "../src/lock.ts";

const NOW = new Date("2026-08-05T10:00:00.000Z");
// Scaled, as every rate is. An unscaled literal here is what let a
// 10^RATE_DECIMALS error in `payerEstimateMinor` pass the whole suite: the
// fixture and the function were consistently wrong together.
const RATE = 3_700_000_000n * RATE_SCALE; // minor USDC per whole ETH

function composed(overrides: Partial<ComposedQuote> = {}): ComposedQuote {
  const executable: PriceQuote = {
    from: "ETH",
    to: "USDC",
    scaledRate: RATE,
    source: "dex",
  };
  const reference: OraclePrice = {
    from: "ETH",
    to: "USDC",
    scaledRate: RATE,
    source: "pyth",
    observedAt: NOW,
  };
  return { from: "ETH", to: "USDC", executable, reference, composedAt: NOW, ...overrides };
}

function terms(overrides: Partial<LockTerms> = {}): LockTerms {
  return {
    settlementAmount: money(3_700_000_000n, "USDC"), // 3,700 USDC
    fee: money(18_500_000n, "USDC"), // 50 bps of it
    slippageBps: 0,
    ttlSeconds: 900,
    ...overrides,
  };
}

describe("lockQuote", () => {
  test("minOut is the merchant's settlement amount, exactly — the hard lock", () => {
    const lock = lockQuote(composed(), terms(), NOW);

    expect(lock.minOut).toEqual(money(3_700_000_000n, "USDC"));
    expect(lock.fee).toEqual(money(18_500_000n, "USDC"));
    expect(lock.executableRate).toBe(RATE);
    expect(lock.executableSource).toBe("dex");
    expect(lock.referenceSource).toBe("pyth");
  });

  test("the deadline is now + TTL; lockedAt is now", () => {
    const lock = lockQuote(composed(), terms(), NOW);

    expect(lock.lockedAt).toEqual(NOW);
    expect(lock.deadline).toEqual(new Date(NOW.getTime() + 900_000));
  });

  test("with zero slippage the payer estimate is the exact conversion, ceiled", () => {
    // 3,700 USDC at 3,700 USDC/ETH is exactly 1 ETH.
    const lock = lockQuote(composed(), terms(), NOW);

    expect(lock.payerEstimate.amount).toEqual(money(10n ** 18n, "ETH"));
    expect(lock.payerEstimate.kind).toBe("display-estimate");
  });

  test("slippage grosses the payer estimate up, never minOut down", () => {
    const lock = lockQuote(composed(), terms({ slippageBps: 100 }), NOW);

    // ceil(1 ETH × 10_000 / 9_900): 1% headroom, rounded up.
    expect(lock.payerEstimate.amount.amount).toBe(1_010_101_010_101_010_102n);
    expect(lock.minOut).toEqual(money(3_700_000_000n, "USDC")); // unchanged
  });

  test("the worst tolerated fill still covers minOut, for awkward amounts", () => {
    for (const minOut of [3_700_000_001n, 123_456_789n, 1n]) {
      for (const slippageBps of [0, 50, 999]) {
        const lock = lockQuote(
          composed(),
          terms({
            settlementAmount: money(minOut, "USDC"),
            fee: money(0n, "USDC"),
            slippageBps,
          }),
          NOW,
        );
        const estimate = lock.payerEstimate.amount.amount;
        // The worst tolerated fill, floored once — the contract compares the
        // swap's single output against minOut, not a twice-truncated model.
        const worst = (estimate * RATE * BigInt(10_000 - slippageBps)) / (10n ** 18n * 10_000n);
        expect(worst >= minOut).toBe(true);
      }
    }
  });

  test("a fee that consumes the settlement amount is refused", () => {
    expect(() => lockQuote(composed(), terms({ fee: money(3_700_000_000n, "USDC") }), NOW)).toThrow(
      ValidationError,
    );
    expect(() => lockQuote(composed(), terms({ fee: money(-1n, "USDC") }), NOW)).toThrow(
      ValidationError,
    );
  });

  test("a non-positive settlement amount is refused", () => {
    expect(() =>
      lockQuote(
        composed(),
        terms({ settlementAmount: money(0n, "USDC"), fee: money(0n, "USDC") }),
        NOW,
      ),
    ).toThrow(ValidationError);
  });

  test("terms in a different asset than the composed pair are a wiring bug", () => {
    expect(() =>
      lockQuote(
        composed(),
        terms({ settlementAmount: money(3_700_00n, "USDT"), fee: money(0n, "USDT") }),
        NOW,
      ),
    ).toThrow(ConfigurationError);
  });

  test("slippage outside 0 ≤ bps < 10_000 is a wiring bug", () => {
    expect(() => lockQuote(composed(), terms({ slippageBps: -1 }), NOW)).toThrow(
      ConfigurationError,
    );
    expect(() => lockQuote(composed(), terms({ slippageBps: 10_000 }), NOW)).toThrow(
      ConfigurationError,
    );
  });

  test("a non-positive TTL is a wiring bug", () => {
    expect(() => lockQuote(composed(), terms({ ttlSeconds: 0 }), NOW)).toThrow(ConfigurationError);
  });
});

describe("isExpired", () => {
  test("a lock is valid through its deadline, inclusive", () => {
    const lock = lockQuote(composed(), terms(), NOW);

    expect(isExpired(lock, lock.deadline)).toBe(false);
    expect(isExpired(lock, new Date(lock.deadline.getTime() + 1))).toBe(true);
  });
});

describe("payer estimate magnitude", () => {
  test("is the amount a human would expect, not a power of ten away from it", () => {
    // 3,700 USDC per ETH. A 3.70 USDC lock is a thousandth of an ETH.
    // Asserted in absolute terms so an error in how the rate is scaled shows up
    // here even if the fixture and the formula agree with each other — which is
    // exactly how a 10^RATE_DECIMALS error passed the rest of this file.
    const lock = lockQuote(
      composed(),
      terms({ settlementAmount: money(3_700_000n, "USDC"), fee: money(0n, "USDC") }),
      NOW,
    );

    expect(lock.payerEstimate.amount).toEqual(money(10n ** 15n, "ETH"));
  });
});
