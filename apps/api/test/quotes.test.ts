import { describe, expect, test } from "bun:test";
import { LiquidityRouter, TablePriceSource } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { priceSourceOf } from "@mayarin/execution";
import { FixedSwapVenue } from "@mayarin/execution/testing";
import { QuoteEngine } from "@mayarin/quote";
import { FakeOrderSigner } from "@mayarin/quote/testing";
import { FixedClock } from "@mayarin/shared";
import type { Container } from "../src/container.ts";
import type { QuoteLayer } from "../src/quote-layer.ts";
import { quoteRoutes } from "../src/routes/quotes.ts";

/** Thursday noon — the FX market is trading, so no closed spread intervenes. */
const NOW = new Date("2026-08-06T12:00:00.000Z");

/** 60,000,000,000 minor USDC per whole ETH — a stand-in rate, value irrelevant. */
const ETH_USDC_RATE = 60_000_000_000n;

/**
 * A quote layer over fakes, mirroring `contract-layer.test.ts`. The venue and
 * oracle agree on ETH -> USDC, IDR -> USDC is a declared peg, and the deviation
 * guard is loose enough that the identical rates pass it.
 */
function quoteLayer(): QuoteLayer {
  const clock = new FixedClock(NOW);
  const venue = new FixedSwapVenue("0x", [
    { from: "ETH", to: "USDC", scaledRate: ETH_USDC_RATE, source: "0x" },
  ]);
  const oracle = new FixedPriceOracle([
    { from: "ETH", to: "USDC", scaledRate: ETH_USDC_RATE, source: "pyth", observedAt: NOW },
  ]);
  const engine = new QuoteEngine({
    venue: priceSourceOf(venue),
    oracle,
    policy: { maxDeviationBps: 100, maxAgeMs: 60_000 },
    fiat: { pegged: ["IDR/USDC"], maxAgeMs: 300_000, closedMaxAgeMs: 300_000, closedSpreadBps: 0 },
    clock,
  });
  return {
    engine,
    venues: [venue],
    oracle,
    signer: new FakeOrderSigner(),
    slippageBps: 50,
    ttlSeconds: 120,
  };
}

/** A `Container` carrying only what `priceFor` reads, stubbed at that seam. */
function stubContainer(quote: QuoteLayer | undefined): Container {
  return {
    market: { quote: async () => quote },
    rates: new LiquidityRouter({ source: new TablePriceSource({ "ETH/USDC": ETH_USDC_RATE }) }),
    config: { settlementAsset: "USDC" },
  } as unknown as Container;
}

async function post(
  app: ReturnType<typeof quoteRoutes>,
  amount: string,
  asset: string,
  assets: string[],
) {
  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: { amount, asset }, assets }),
  });
  return (await res.json()) as {
    quotes: Array<{
      asset: string;
      available: boolean;
      rate: { source: string } | null;
      reason?: string;
    }>;
  };
}

describe("quotes route — which source prices the swap leg", () => {
  test("a fiat-priced order prices the payer asset through the venue, not the table", async () => {
    const app = quoteRoutes(stubContainer(quoteLayer()));
    const { quotes } = await post(app, "35000.00", "IDR", ["ETH"]);

    expect(quotes[0]?.available).toBe(true);
    // The venue priced it — the same source the lock would sign against.
    expect(quotes[0]?.rate?.source).toBe("0x");
  });

  test("with the quote layer on, a crypto-priced merchant is refused — not table-priced", async () => {
    // The engine's fiat leg needs a fiat price, and a merchant pricing in ETH
    // has none; the contract and executable-deposit locks refuse the same pair.
    // Falling back to the static table would show a number the lock can never
    // produce, so the preview refuses it too.
    const app = quoteRoutes(stubContainer(quoteLayer()));
    const { quotes } = await post(app, "1.00000000", "ETH", ["USDC"]);

    expect(quotes[0]?.available).toBe(false);
    expect(quotes[0]?.reason).toMatch(/fiat/i);
  });

  test("without the quote layer, the static table is the stand-in for every pair", async () => {
    // Quote layer off: no venue is wired, so the table is the only source —
    // including for a crypto-priced merchant, exactly as the non-executed
    // deposit path prices one. The fallback is the dev stand-in, not a lie.
    const app = quoteRoutes(stubContainer(undefined));
    const { quotes } = await post(app, "1.00000000", "ETH", ["USDC"]);

    expect(quotes[0]?.available).toBe(true);
    expect(quotes[0]?.rate?.source).toBe("table");
  });
});
