import { describe, expect, test } from "bun:test";
import type { DeviationPolicy, OraclePrice } from "@mayarin/clearing";
import { ConstantProductPriceSource, TablePriceSource } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import {
  type AssetCode,
  ConfigurationError,
  FixedClock,
  isMayarinError,
  type Money,
  money,
  ProviderError,
  RATE_SCALE,
} from "@mayarin/shared";
import { QuoteEngine } from "../src/engine.ts";

const NOW = new Date("2026-08-05T10:00:00.000Z");
const POLICY: DeviationPolicy = { maxDeviationBps: 50, maxAgeMs: 5_000 };

function reference(overrides: Partial<OraclePrice> = {}): OraclePrice {
  return {
    from: "ETH",
    to: "USDC",
    scaledRate: 3_700_000_000n * RATE_SCALE,
    source: "pyth",
    observedAt: NOW,
    ...overrides,
  };
}

function engine(overrides: Partial<ConstructorParameters<typeof QuoteEngine>[0]> = {}) {
  return new QuoteEngine({
    venue: new TablePriceSource({ "ETH/USDC": 3_700_000_000n }, "dex"),
    oracle: new FixedPriceOracle([reference()]),
    policy: POLICY,
    fiat: { pegged: ["USD/USDC"], maxAgeMs: 60_000, closedMaxAgeMs: 60_000, closedSpreadBps: 0 },
    clock: new FixedClock(NOW),
    ...overrides,
  });
}

describe("QuoteEngine.compose", () => {
  test("composes the venue's executable price with the oracle's reference", async () => {
    const composed = await engine().compose("ETH", "USDC", money(10n ** 18n, "ETH"));

    expect(composed.executable.scaledRate).toBe(3_700_000_000n * RATE_SCALE);
    expect(composed.executable.source).toBe("dex");
    expect(composed.reference.source).toBe("pyth");
    expect(composed.composedAt).toEqual(NOW);
  });

  test("a stale oracle observation fails composition as a retryable ProviderError", async () => {
    const stale = engine({
      oracle: new FixedPriceOracle([reference({ observedAt: new Date(NOW.getTime() - 60_000) })]),
    });

    try {
      await stale.compose("ETH", "USDC", money(10n ** 18n, "ETH"));
      throw new Error("expected compose to throw");
    } catch (error) {
      if (!isMayarinError(error)) throw error;
      expect(error.code).toBe("PROVIDER_ERROR");
      expect(error.retryable).toBe(true);
      expect(error.message).toContain("stale");
    }
  });

  test("a venue price outside the deviation bound fails composition", async () => {
    // 3_900_000_000 vs a 3_700_000_000 reference is ~540 bps, limit 50.
    const drifted = engine({
      venue: new TablePriceSource({ "ETH/USDC": 3_900_000_000n }, "dex"),
    });

    expect(drifted.compose("ETH", "USDC", money(10n ** 18n, "ETH"))).rejects.toThrow(ProviderError);
  });

  test("an explicitly unguarded testnet pair self-references for integration testing", async () => {
    const drifted = engine({
      venue: new TablePriceSource({ "ETH/USDC": 39_000_000_000n }, "testnet-dex"),
      unguardedTestnetPairs: ["ethereum-sepolia:ETH/USDC"],
    });

    const composed = await drifted.compose(
      "ETH",
      "USDC",
      money(10n ** 18n, "ETH"),
      "ethereum-sepolia",
    );

    expect(composed.reference.source).toBe("testnet-self-reference");
    expect(composed.reference.scaledRate).toBe(composed.executable.scaledRate);
  });

  test("an unguarded pair is refused on mainnet", async () => {
    const unsafe = engine({ unguardedTestnetPairs: ["base:ETH/USDC"] });

    expect(unsafe.compose("ETH", "USDC", money(10n ** 18n, "ETH"), "base")).rejects.toThrow(
      ConfigurationError,
    );
  });

  test("a swap big enough to move the pool past the bound fails; a small one passes", async () => {
    // 1,000 ETH / 3.7M USDC pool: marginal price equals the oracle reference.
    const pooled = engine({
      venue: new ConstantProductPriceSource({
        "ETH/USDC": { reserveFrom: 1_000n * 10n ** 18n, reserveTo: 3_700_000n * 10n ** 6n },
      }),
    });

    // 0.1 ETH barely moves the pool (~1 bps) — within the 50 bps bound.
    const small = await pooled.compose("ETH", "USDC", money(10n ** 17n, "ETH"));
    expect(small.executable.scaledRate).toBeLessThanOrEqual(3_700_000_000n * RATE_SCALE);

    // 100 ETH moves it ~900 bps — the guard rejects before any lock exists.
    expect(pooled.compose("ETH", "USDC", money(100n * 10n ** 18n, "ETH"))).rejects.toThrow(
      ProviderError,
    );
  });

  test("a same-asset pair is a wiring mistake, not a quote", async () => {
    expect(engine().compose("USDC", "USDC", money(1_000_000n, "USDC"))).rejects.toThrow(
      ConfigurationError,
    );
  });

  test("a venue with no pair configured propagates ConfigurationError", async () => {
    const bare = engine({ venue: new TablePriceSource({}, "dex") });

    expect(bare.compose("ETH", "USDC", money(10n ** 18n, "ETH"))).rejects.toThrow(
      ConfigurationError,
    );
  });

  test("an oracle with no reference for the pair propagates ConfigurationError", async () => {
    const blind = engine({ oracle: new FixedPriceOracle([]) });

    expect(blind.compose("ETH", "USDC", money(10n ** 18n, "ETH"))).rejects.toThrow(
      ConfigurationError,
    );
  });
});

describe("quoteFiatPrice — both legs", () => {
  // A coffee at Rp 35.000, merchant settles in USDC, payer pays ETH.
  const PRICE = money(35_000_00n, "IDR");

  function twoLegEngine() {
    return engine({
      oracle: new FixedPriceOracle([
        reference(), // ETH/USDC, guards the swap leg
        {
          from: "IDR",
          to: "USDC",
          scaledRate: 61n * RATE_SCALE,
          source: "pyth",
          observedAt: NOW,
        },
      ]),
    });
  }

  test("prices a fiat amount into settlement, then into the payer asset", async () => {
    const quote = await twoLegEngine().quoteFiatPrice({
      price: PRICE,
      settlementAsset: "USDC",
      payerAsset: "ETH",
      probe: money(10n ** 15n, "ETH"),
    });

    // Fiat leg: 35_000 whole IDR × 61 = 2.135000 USDC.
    expect(quote.settlement.settlementAmount).toEqual(money(2_135_000n, "USDC"));
    expect(quote.settlement.kind).toBe("oracle");

    // Swap leg: the venue rate the payer estimate will be derived from.
    expect("composed" in quote).toBe(true);
    if ("composed" in quote) {
      expect(quote.composed.from).toBe("ETH");
      expect(quote.composed.to).toBe("USDC");
      expect(quote.composed.executable.scaledRate).toBe(3_700_000_000n * RATE_SCALE);
    }
  });

  test("a payer already holding the settlement asset has no swap leg", async () => {
    const quote = await twoLegEngine().quoteFiatPrice({
      price: PRICE,
      settlementAsset: "USDC",
      payerAsset: "USDC",
      probe: money(2_135_000n, "USDC"),
    });

    expect(quote.settlement.settlementAmount).toEqual(money(2_135_000n, "USDC"));
    expect("composed" in quote).toBe(false);
  });

  test("a USD price settling into USDC takes the peg and never reads a rate", async () => {
    const quote = await twoLegEngine().quoteFiatPrice({
      price: money(100_00n, "USD"),
      settlementAsset: "USDC",
      payerAsset: "USDC",
      probe: money(100_000_000n, "USDC"),
    });

    expect(quote.settlement.kind).toBe("pegged");
    expect(quote.settlement.settlementAmount).toEqual(money(100_000_000n, "USDC"));
  });

  test("a stale FX reference fails the whole quote, before any lock exists", async () => {
    const stale = engine({
      oracle: new FixedPriceOracle([
        reference(),
        {
          from: "IDR",
          to: "USDC",
          scaledRate: 61n * RATE_SCALE,
          source: "pyth",
          observedAt: new Date(NOW.getTime() - 120_000),
        },
      ]),
    });

    await expect(
      stale.quoteFiatPrice({
        price: PRICE,
        settlementAsset: "USDC",
        payerAsset: "ETH",
        probe: money(10n ** 15n, "ETH"),
      }),
    ).rejects.toThrow(ProviderError);
  });
});

describe("QuoteEngine chain", () => {
  // The engine holds one `PriceSource`; whether that source can serve the chain
  // is its business. What the engine owes is to say which chain is being priced.
  test("compose passes the chain through to the venue", async () => {
    const seen: Array<string | undefined> = [];
    const composed = await engine({
      venue: {
        price: async (from, to, _amount, chain) => {
          seen.push(chain);
          return { from, to, scaledRate: 3_700_000_000n * RATE_SCALE, source: "venue" };
        },
      },
    }).compose("ETH", "USDC", money(10n ** 18n, "ETH"), "base-sepolia");

    expect(seen).toEqual(["base-sepolia"]);
    expect(composed.executable.source).toBe("venue");
  });

  test("quoteFiatPrice passes the chain down to the swap leg", async () => {
    const seen: Array<string | undefined> = [];
    await engine({
      venue: {
        price: async (from, to, _amount, chain) => {
          seen.push(chain);
          return { from, to, scaledRate: 3_700_000_000n * RATE_SCALE, source: "venue" };
        },
      },
    }).quoteFiatPrice({
      price: money(5_000n, "USD"),
      settlementAsset: "USDC",
      payerAsset: "ETH",
      probe: money(10n ** 18n, "ETH"),
      chain: "arc-testnet",
    });

    expect(seen).toEqual(["arc-testnet"]);
  });
});

/**
 * The Base Sepolia EURC/USDC pool, as measured on 2026-09-05. Thin enough that
 * the rate falls apart with size, which is the whole reason exact-output
 * pricing exists:
 *
 *   1.000000 EURC -> 0.817981 USDC   (rate 0.817981)
 *   4.885472 EURC -> 3.676905 USDC   (rate 0.752620)
 *
 * and 3.976241 USDC out needs 5.331676 EURC in.
 */
const THIN_POOL = {
  probeRate: 817_981n * RATE_SCALE,
  exactOutRate: 745_774n * RATE_SCALE,
};

describe("QuoteEngine exact-output pricing", () => {
  function venueWith(seen: string[]) {
    return {
      price: async (from: AssetCode, to: AssetCode) => {
        seen.push("exact-input");
        return { from, to, scaledRate: THIN_POOL.probeRate, source: "uniswap" };
      },
      priceExactOutput: async (from: AssetCode, to: AssetCode, exactOut: Money) => {
        seen.push(`exact-output:${exactOut.amount}`);
        return { from, to, scaledRate: THIN_POOL.exactOutRate, source: "uniswap" };
      },
    };
  }

  // The bug: the swap leg was priced at one whole unit, so `minOut` was set
  // 9% above what the pool could fill and the swap reverted `STF` — after the
  // payer had already sent their funds.
  test("prices the swap leg at the settlement amount, not at the probe", async () => {
    const seen: string[] = [];
    const quoted = await engine({
      venue: venueWith(seen),
      oracle: new FixedPriceOracle([
        reference({ from: "EURC", scaledRate: THIN_POOL.exactOutRate }),
      ]),
    }).quoteFiatPrice({
      price: money(500n, "USD"),
      settlementAsset: "USDC",
      payerAsset: "EURC",
      probe: money(1_000_000n, "EURC"),
    });

    // The settlement amount, in USDC minor units — never the one-unit probe.
    expect(seen).toEqual(["exact-output:5000000"]);
    expect("composed" in quoted && quoted.composed.executable.scaledRate).toBe(
      THIN_POOL.exactOutRate,
    );
  });

  test("the chain travels with the exact-output ask", async () => {
    const seen: string[] = [];
    const chains: (string | undefined)[] = [];
    await engine({
      venue: {
        price: async (from: AssetCode, to: AssetCode) => ({
          from,
          to,
          scaledRate: THIN_POOL.probeRate,
          source: "uniswap",
        }),
        priceExactOutput: async (
          from: AssetCode,
          to: AssetCode,
          _exactOut: Money,
          chain?: string,
        ) => {
          chains.push(chain);
          seen.push("exact-output");
          return { from, to, scaledRate: THIN_POOL.exactOutRate, source: "uniswap" };
        },
      },
      oracle: new FixedPriceOracle([
        reference({ from: "EURC", scaledRate: THIN_POOL.exactOutRate }),
      ]),
    }).quoteFiatPrice({
      price: money(500n, "USD"),
      settlementAsset: "USDC",
      payerAsset: "EURC",
      probe: money(1_000_000n, "EURC"),
      chain: "base-sepolia",
    });

    expect(chains).toEqual(["base-sepolia"]);
  });

  // A rate table has no depth, so its forward price is already exact — there
  // is nothing to fall back *from*.
  test("a source that cannot price backwards still gets the probe", async () => {
    const seen: string[] = [];
    const quoted = await engine({
      venue: {
        price: async (from: AssetCode, to: AssetCode) => {
          seen.push("exact-input");
          return { from, to, scaledRate: THIN_POOL.probeRate, source: "table" };
        },
      },
      oracle: new FixedPriceOracle([reference({ from: "EURC", scaledRate: THIN_POOL.probeRate })]),
    }).quoteFiatPrice({
      price: money(500n, "USD"),
      settlementAsset: "USDC",
      payerAsset: "EURC",
      probe: money(1_000_000n, "EURC"),
    });

    expect(seen).toEqual(["exact-input"]);
    expect("composed" in quoted).toBe(true);
  });

  // A venue outage must not quietly downgrade the quote to the less accurate
  // direction — that is how the bug would come back without anyone noticing.
  test("a venue fault on the exact-output ask is not swallowed", async () => {
    const failing = {
      price: async (from: AssetCode, to: AssetCode) => ({
        from,
        to,
        scaledRate: THIN_POOL.probeRate,
        source: "uniswap",
      }),
      priceExactOutput: () => Promise.reject(new ProviderError("quoter reverted", {})),
    };

    expect(
      engine({
        venue: failing,
        oracle: new FixedPriceOracle([
          reference({ from: "EURC", scaledRate: THIN_POOL.exactOutRate }),
        ]),
      }).quoteFiatPrice({
        price: money(500n, "USD"),
        settlementAsset: "USDC",
        payerAsset: "EURC",
        probe: money(1_000_000n, "EURC"),
      }),
    ).rejects.toThrow(ProviderError);
  });

  test("a same-asset payment still needs no venue at all", async () => {
    const seen: string[] = [];
    const quoted = await engine({ venue: venueWith(seen) }).quoteFiatPrice({
      price: money(500n, "USD"),
      settlementAsset: "USDC",
      payerAsset: "USDC",
      probe: money(1_000_000n, "USDC"),
    });

    expect(seen).toEqual([]);
    expect("composed" in quoted).toBe(false);
  });
});
