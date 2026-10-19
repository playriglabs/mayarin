import { describe, expect, test } from "bun:test";
import { BelowMinimumError } from "@mayarin/provider-transfi";
import { FixedClock } from "@mayarin/shared";
import { type FloorQuote, MethodFloors } from "../src/services/fiat-methods.ts";

/** TransFi sandbox, as measured: every IDR method refuses under 92,015, listed minimum or not. */
const IDR = [
  { code: "qris", type: "local_wallet", minAmount: 1 },
  { code: "dana", type: "local_wallet", minAmount: 10_000 },
  { code: "bca", type: "bank_transfer", minAmount: 10_000 },
];
const RATE = 18_478; // IDR per USDC at the floor

const sandbox =
  (counter: { calls: number }): FloorQuote =>
  async ({ fiatAmount }) => {
    counter.calls += 1;
    if (fiatAmount < 92_015) throw new BelowMinimumError(92_015);
    return { destinationAmount: fiatAmount / RATE };
  };

function floors(quote: FloorQuote, clock = new FixedClock("2026-01-01T00:00:00.000Z")) {
  return { floors: new MethodFloors({ quote, clock, tolerance: 1.05 }), clock };
}

describe("MethodFloors: never offer a method that would charge more than is owed", () => {
  test("a Rp 65,000 payment (≈ 3.60 USDC) is offered no IDR method: every minimum would overcharge it", async () => {
    const { floors: f } = floors(sandbox({ calls: 0 }));
    expect(await f.fit(IDR, "IDR", "USDC", 3.6)).toEqual([]);
  });

  test("a payment at the minimum is offered every method", async () => {
    const { floors: f } = floors(sandbox({ calls: 0 }));
    const offered = await f.fit(IDR, "IDR", "USDC", 4.98);
    expect(offered.map((m) => m.code)).toEqual(["qris", "dana", "bca"]);
  });

  test("a larger payment is offered every method too", async () => {
    const { floors: f } = floors(sandbox({ calls: 0 }));
    expect(await f.fit(IDR, "IDR", "USDC", 40)).toHaveLength(3);
  });

  test("only the methods whose own minimum is too high are left out", async () => {
    // PHP, as measured: GCash 129 (≈ 1.99 USDC), PayMaya 200 (≈ 3.09 USDC).
    const minimums: Record<string, number> = { gcash: 129, ph_paymaya: 200 };
    const quote: FloorQuote = async ({ paymentCode, fiatAmount }) => {
      const min = minimums[paymentCode] as number;
      if (fiatAmount < min) throw new BelowMinimumError(min);
      return { destinationAmount: fiatAmount / 64.7 };
    };
    const { floors: f } = floors(quote);
    const php = [
      { code: "gcash", type: "local_wallet", minAmount: 100 },
      { code: "ph_paymaya", type: "local_wallet", minAmount: 200 },
    ];
    expect((await f.fit(php, "PHP", "USDC", 2.0)).map((m) => m.code)).toEqual(["gcash"]);
  });

  test("minimums are kept for ten minutes, then read again", async () => {
    const counter = { calls: 0 };
    const { floors: f, clock } = floors(sandbox(counter));
    await f.fit(IDR, "IDR", "USDC", 40);
    const first = counter.calls;
    await f.fit(IDR, "IDR", "USDC", 40);
    expect(counter.calls).toBe(first);

    clock.advance(10 * 60_000 + 1);
    await f.fit(IDR, "IDR", "USDC", 40);
    expect(counter.calls).toBeGreaterThan(first);
  });

  test("a provider outage hides nothing and is not remembered", async () => {
    let up = false;
    const quote: FloorQuote = async ({ fiatAmount }) => {
      if (!up) throw new Error("fetch failed");
      if (fiatAmount < 92_015) throw new BelowMinimumError(92_015);
      return { destinationAmount: fiatAmount / RATE };
    };
    const { floors: f } = floors(quote);
    expect(await f.fit(IDR, "IDR", "USDC", 3.6)).toHaveLength(3);

    up = true;
    expect(await f.fit(IDR, "IDR", "USDC", 3.6)).toEqual([]);
  });

  test("the same method in another token is measured separately", async () => {
    const counter = { calls: 0 };
    const { floors: f } = floors(sandbox(counter));
    await f.fit([IDR[0] as (typeof IDR)[number]], "IDR", "USDC", 40);
    const after = counter.calls;
    await f.fit([IDR[0] as (typeof IDR)[number]], "IDR", "USDT", 40);
    expect(counter.calls).toBeGreaterThan(after);
  });
});
