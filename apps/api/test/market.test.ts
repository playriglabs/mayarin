/**
 * Runtime market configuration tests (#95).
 *
 * The property under test is that a change reaches the next payment without a
 * restart, and that a bad change reaches nothing at all.
 */

import { describe, expect, test } from "bun:test";
import { TablePriceSource } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { QuoteEngine } from "@mayarin/quote";
import { FakeOrderSigner } from "@mayarin/quote/testing";
import { FixedClock, money, ValidationError } from "@mayarin/shared";
import { InMemoryMarketConfigStore } from "@mayarin/shared/testing";
import { type Config, loadConfig } from "../src/config.ts";
import {
  MARKET_CONFIG_KEYS,
  RuntimeMarket,
  RuntimePriceSource,
  RuntimeStablecoinRegistry,
} from "../src/market.ts";
import type { QuoteLayer } from "../src/quote-layer.ts";

const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDT = "0x1111111111111111111111111111111111111111";

function harness() {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const config: Config = loadConfig({
    PORT: "3000",
    DATABASE_URL: "memory://",
    SETTLEMENT_ASSET: "IDRX",
    EXCHANGE_RATES: '{"IDR/IDRX":"100"}',
    CHAIN_ASSETS: `{"base-sepolia":{"USDC":"${USDC}"}}`,
  });
  const store = new InMemoryMarketConfigStore();
  // No cache window: the tests are about what a change does, not about how long
  // it takes to be noticed.
  const market = new RuntimeMarket({ store, config, clock, cacheMs: 0 });
  return { clock, config, store, market };
}

describe("seeding from the environment", () => {
  test("writes every key once", async () => {
    const { market } = harness();
    expect(await market.seedFromEnvironment()).toEqual([...MARKET_CONFIG_KEYS]);
  });

  test("a second boot overwrites nothing", async () => {
    const { market } = harness();
    await market.seedFromEnvironment();
    await market.put("exchangeRates", { "IDR/IDRX": "999" });

    expect(await market.seedFromEnvironment()).toEqual([]);

    const entries = await market.entries();
    const rates = entries.find((entry) => entry.key === "exchangeRates");
    expect(rates?.value).toEqual({ "IDR/IDRX": "999" });
  });
});

describe("admitting a stablecoin without a restart", () => {
  test("the registry refuses an asset the environment never named", async () => {
    const { market } = harness();
    const registry = new RuntimeStablecoinRegistry(market);
    expect(await registry.isSettlementAsset("USDT")).toBe(false);
  });

  test("and admits it once the table says so", async () => {
    const { market } = harness();
    const registry = new RuntimeStablecoinRegistry(market);
    await market.seedFromEnvironment();

    await market.put("stablecoins", [
      { asset: "IDRX", onChain: [] },
      { asset: "USDT", onChain: [{ chain: "base-sepolia", address: USDT }] },
    ]);

    expect(await registry.isSettlementAsset("USDT")).toBe(true);
    expect(await registry.isDepositAsset("USDT", "base-sepolia")).toBe(true);
    expect(await registry.address("USDT", "base-sepolia")).toBe(USDT);
  });
});

describe("rates", () => {
  test("a rate added at runtime prices the next payment", async () => {
    const { market } = harness();
    await market.seedFromEnvironment();
    await market.put("exchangeRates", { "IDR/IDRX": "100", "IDR/USDC": "6" });

    const source = await market.rates();
    const quote = await source.price("IDR", "USDC", { amount: 100n, asset: "IDR" });

    // Rates carry RATE_DECIMALS fractional digits, so "6" is 6 × 10^9 scaled.
    expect(quote.scaledRate).toBe(6_000_000_000n);
  });

  test("a configured quote layer prices fiat into stablecoin for the clearing lock", async () => {
    const observedAt = new Date("2026-01-01T00:00:00.000Z");
    const oracle = new FixedPriceOracle([
      {
        from: "SGD",
        to: "USDC",
        scaledRate: 781_440_000_000_000n,
        source: "pyth",
        observedAt,
      },
    ]);
    const engine = new QuoteEngine({
      venue: new TablePriceSource(),
      oracle,
      policy: { maxDeviationBps: 100, maxAgeMs: 60_000 },
      fiat: {
        pegged: [],
        maxAgeMs: 300_000,
        closedMaxAgeMs: 300_000,
        closedSpreadBps: 0,
      },
      clock: new FixedClock(observedAt),
    });
    const quote: QuoteLayer = {
      engine,
      venues: [],
      oracle,
      signer: new FakeOrderSigner(),
      slippageBps: 50,
      ttlSeconds: 60,
    };
    const source = new RuntimePriceSource({
      quote: async () => quote,
      rates: async () => new TablePriceSource(),
    });

    const priced = await source.price("SGD", "USDC", money(100n, "SGD"));

    expect(priced.source).toBe("pyth");
    expect(priced.scaledRate).toBe(781_440_000_000_000n);
  });
});

describe("a bad write reaches nothing", () => {
  test("an unparseable value is refused rather than stored", async () => {
    const { market, store } = harness();
    await market.seedFromEnvironment();

    await expect(market.put("stablecoins", { not: "an array" })).rejects.toBeInstanceOf(
      ValidationError,
    );

    // Still what the environment seeded — IDRX as a settlement asset plus the
    // USDC named by CHAIN_ASSETS — rather than the rejected value.
    const stored = await store.get("stablecoins");
    expect(stored?.value).toEqual([
      { asset: "IDRX", onChain: [] },
      { asset: "USDC", onChain: [{ chain: "base-sepolia", address: USDC.toLowerCase() }] },
    ]);
  });

  test("a rate that is not an integer string is refused", async () => {
    const { market } = harness();
    await expect(market.put("exchangeRates", { "IDR/IDRX": "1.5" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("a stored row that cannot be parsed falls back to the environment", async () => {
    const { market, store, clock } = harness();
    // Written straight to the store, bypassing validation — the shape a bad
    // migration or a hand-edited row would leave behind.
    await store.put({ key: "exchangeRates", value: "nonsense", updatedAt: clock.now() });

    const source = await market.rates();
    const quote = await source.price("IDR", "IDRX", { amount: 100n, asset: "IDR" });

    // The environment's `IDR/IDRX` rate of 100, scaled by RATE_DECIMALS.
    expect(quote.scaledRate).toBe(100_000_000_000n);
  });
});

describe("caching", () => {
  test("a snapshot is reused inside the cache window", async () => {
    const { config, store, clock } = harness();
    const market = new RuntimeMarket({ store, config, clock, cacheMs: 60_000 });
    const registry = new RuntimeStablecoinRegistry(market);

    await market.seedFromEnvironment();
    expect(await registry.isSettlementAsset("USDT")).toBe(false);

    // Written behind the service's back, so only the cache decides what is seen.
    await store.put({
      key: "stablecoins",
      value: [{ asset: "USDT", onChain: [] }],
      updatedAt: clock.now(),
    });
    expect(await registry.isSettlementAsset("USDT")).toBe(false);

    clock.advance(60_000);
    expect(await registry.isSettlementAsset("USDT")).toBe(true);
  });

  test("a write through the service is visible immediately", async () => {
    const { config, store, clock } = harness();
    const market = new RuntimeMarket({ store, config, clock, cacheMs: 60_000 });
    const registry = new RuntimeStablecoinRegistry(market);

    await market.seedFromEnvironment();
    expect(await registry.isSettlementAsset("USDT")).toBe(false);

    await market.put("stablecoins", [{ asset: "USDT", onChain: [] }]);
    expect(await registry.isSettlementAsset("USDT")).toBe(true);
  });
});
