/**
 * Rail pricing cache (#244).
 *
 * The catalog drops a rail it cannot price, which is right — a payer offered a
 * pair the lock will refuse gets a FAILED payment instead of a QR. What it must
 * not do is remember a refusal that was never an answer.
 */

import { describe, expect, test } from "bun:test";
import type { RateQuote } from "@mayarin/clearing";
import { type AssetCode, ProviderError, ValidationError } from "@mayarin/shared";
import { QuotePricingSource } from "../src/rails.ts";

const RAIL = { chain: "arc-testnet", asset: "EURC", settlementAsset: "USDC" } as const;

function context(rates: (from: AssetCode, to: AssetCode) => Promise<RateQuote>) {
  return {
    // No quote layer: `canPrice` falls through to the rate provider, which is
    // the same branch a deployment without venues takes.
    market: { quote: async () => undefined },
    rates: { quote: rates },
    config: { settlementAsset: "USDC" as const },
  };
}

describe("QuotePricingSource", () => {
  test("a pair that prices is offered", async () => {
    const source = new QuotePricingSource(
      context(async () => ({ from: "EURC", to: "USDC", scaledRate: 1_408_170n, source: "fx" })),
    );

    expect(await source.canPrice(RAIL)).toBe(true);
  });

  test("a payer sending the settlement asset needs no rate at all", async () => {
    let asked = 0;
    const source = new QuotePricingSource(
      context(async () => {
        asked += 1;
        throw new ProviderError("should not be asked", {});
      }),
    );

    expect(await source.canPrice({ ...RAIL, asset: "USDC" })).toBe(true);
    expect(asked).toBe(0);
  });

  // The bug this pins: a moment's rate limit on the oracle deleted every EURC
  // rail from the counter, and the cache kept it deleted for the whole TTL
  // after the oracle had recovered.
  test("a retryable failure is not remembered", async () => {
    let attempt = 0;
    const source = new QuotePricingSource(
      context(async () => {
        attempt += 1;
        if (attempt === 1) {
          throw new ProviderError("FX API responded 429", {}, { retryable: true });
        }
        return { from: "EURC", to: "USDC", scaledRate: 1_408_170n, source: "fx" };
      }),
    );

    expect(await source.canPrice(RAIL)).toBe(false);
    // Asked again rather than served the cached refusal.
    expect(await source.canPrice(RAIL)).toBe(true);
    expect(attempt).toBe(2);
  });

  test("a settled refusal is remembered for the window", async () => {
    let attempt = 0;
    const source = new QuotePricingSource(
      context(async () => {
        attempt += 1;
        // Not retryable: this venue does not serve this pair, and will not
        // start serving it within the cache window.
        throw new ValidationError("no feed for EURC -> USDC");
      }),
    );

    expect(await source.canPrice(RAIL)).toBe(false);
    expect(await source.canPrice(RAIL)).toBe(false);
    expect(attempt).toBe(1);
  });

  test("a zero rate is a settled refusal, not a fault", async () => {
    let attempt = 0;
    const source = new QuotePricingSource(
      context(async () => {
        attempt += 1;
        return { from: "EURC", to: "USDC", scaledRate: 0n, source: "fx" };
      }),
    );

    expect(await source.canPrice(RAIL)).toBe(false);
    expect(await source.canPrice(RAIL)).toBe(false);
    expect(attempt).toBe(1);
  });

  test("each rail is cached on its own key", async () => {
    const seen: string[] = [];
    const source = new QuotePricingSource(
      context(async (from, to) => {
        seen.push(`${from}/${to}`);
        return { from, to, scaledRate: 1n, source: "fx" };
      }),
    );

    await source.canPrice(RAIL);
    await source.canPrice({ ...RAIL, chain: "base-sepolia" });
    await source.canPrice(RAIL);

    // Two chains, two lookups; the repeat is served from the cache.
    expect(seen).toHaveLength(2);
  });
});
