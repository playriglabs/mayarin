import { describe, expect, test } from "bun:test";
import type { OraclePrice, PriceOracle } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import {
  ConfigurationError,
  money,
  ProviderError,
  RATE_SCALE,
  ValidationError,
} from "@mayarin/shared";
import { fiatPairKey, priceInSettlement } from "../src/fx.ts";

/** A Thursday noon — the FX market is trading. */
const NOW = new Date("2026-08-06T12:00:00.000Z");
/** The Saturday after it, with the market shut since Friday's 21:00 close. */
const WEEKEND = new Date("2026-08-08T12:00:00.000Z");

const POLICY = {
  pegged: ["USD/USDC"],
  maxAgeMs: 60_000,
  closedMaxAgeMs: 60_000,
  closedSpreadBps: 0,
} as const;

/** Reaches back past Friday's close, and charges 100 bps for doing so. */
const WEEKEND_POLICY = {
  ...POLICY,
  closedMaxAgeMs: 3 * 24 * 60 * 60 * 1_000,
  closedSpreadBps: 100,
} as const;

/** IDR 1 = 0.0000615 USDC — 6-dec USDC, so 61 minor units per whole IDR. */
function idrUsdc(overrides: Partial<OraclePrice> = {}): OraclePrice {
  return {
    from: "IDR",
    to: "USDC",
    scaledRate: 61n * RATE_SCALE,
    source: "pyth",
    observedAt: NOW,
    ...overrides,
  };
}

function oracle(price: OraclePrice = idrUsdc()): PriceOracle {
  return new FixedPriceOracle([price]);
}

describe("priceInSettlement — pegged pairs", () => {
  test("USD into USDC is a decimal rescale, not an exchange rate", async () => {
    // The same currency in two representations: 2-decimal fiat into 6-decimal
    // stablecoin is an exact 10^4 shift, and reading a rate for it would add a
    // rounding step to an exact answer.
    const result = await priceInSettlement(
      oracle(),
      money(100_00n, "USD"), // $100.00
      "USDC",
      POLICY,
      NOW,
    );

    expect(result.kind).toBe("pegged");
    expect(result.source).toBe("peg");
    expect(result.settlementAmount).toEqual(money(100_000_000n, "USDC"));
    expect(result.observedAt).toBeUndefined();
  });

  test("a pegged pair never consults the oracle — nothing to go stale", async () => {
    const stale = oracle(idrUsdc({ observedAt: new Date(NOW.getTime() - 3_600_000) }));
    const result = await priceInSettlement(stale, money(100_00n, "USD"), "USDC", POLICY, NOW);
    expect(result.kind).toBe("pegged");
  });

  test("a pair is pegged only when the deployment says so", async () => {
    // IDR/USDC is not a peg, so it must go through the oracle even though both
    // are "the same money" in a loose sense.
    const result = await priceInSettlement(oracle(), money(35_000_00n, "IDR"), "USDC", POLICY, NOW);
    expect(result.kind).toBe("oracle");
  });
});

describe("priceInSettlement — oracle pairs", () => {
  test("converts a fiat price into the settlement stablecoin", async () => {
    // 35.000,00 IDR = 35_000 whole IDR × 61 minor USDC = 2_135_000 minor = 2.135 USDC
    const result = await priceInSettlement(oracle(), money(35_000_00n, "IDR"), "USDC", POLICY, NOW);

    expect(result.settlementAmount).toEqual(money(2_135_000n, "USDC"));
    expect(result.source).toBe("pyth");
    expect(result.observedAt).toEqual(NOW);
  });

  test("rounds up, so the merchant is never short", async () => {
    // 1 whole IDR at 61 minor units, but only 0,01 IDR of price: 61/100 = 0.61,
    // which must land on 1 rather than 0.
    const result = await priceInSettlement(oracle(), money(1n, "IDR"), "USDC", POLICY, NOW);
    expect(result.settlementAmount).toEqual(money(1n, "USDC"));
  });

  test("refuses a stale reference", async () => {
    const stale = oracle(idrUsdc({ observedAt: new Date(NOW.getTime() - 61_000) }));
    await expect(
      priceInSettlement(stale, money(35_000_00n, "IDR"), "USDC", POLICY, NOW),
    ).rejects.toThrow(ProviderError);
  });
});

describe("priceInSettlement — a closed FX market", () => {
  /** Friday's last publish, ~39 hours before the Saturday noon under test. */
  function fridayClose(): OraclePrice {
    return idrUsdc({ observedAt: new Date("2026-08-07T20:55:00.000Z") });
  }

  test("accepts Friday's close on a Saturday, under the closed bound", async () => {
    const result = await priceInSettlement(
      oracle(fridayClose()),
      money(35_000_00n, "IDR"),
      "USDC",
      WEEKEND_POLICY,
      WEEKEND,
    );

    expect(result.kind).toBe("oracle-closed");
    expect(result.source).toBe("pyth");
  });

  test("the same observation on a trading day is stale", async () => {
    // The whole point of a separate bound: a 39-hour-old rate is the best that
    // exists on a Saturday and a dead feed on a Thursday. The wide bound must
    // not follow the rate into the trading week.
    await expect(
      priceInSettlement(
        oracle(idrUsdc({ observedAt: new Date(NOW.getTime() - 39 * 60 * 60 * 1_000) })),
        money(35_000_00n, "IDR"),
        "USDC",
        WEEKEND_POLICY,
        NOW,
      ),
    ).rejects.toThrow(ProviderError);
  });

  test("the closed bound still has an edge — a feed dead for a week fails", async () => {
    await expect(
      priceInSettlement(
        oracle(idrUsdc({ observedAt: new Date(WEEKEND.getTime() - 7 * 24 * 60 * 60 * 1_000) })),
        money(35_000_00n, "IDR"),
        "USDC",
        WEEKEND_POLICY,
        WEEKEND,
      ),
    ).rejects.toThrow(ProviderError);
  });

  test("the spread widens the settlement amount, so the merchant is covered", async () => {
    // Trading hours put Rp 35.000,00 at 2.135000 USDC; 100 bps on top of the
    // rate is 61,61 minor units per whole rupiah, so 2.156350.
    const result = await priceInSettlement(
      oracle(fridayClose()),
      money(35_000_00n, "IDR"),
      "USDC",
      WEEKEND_POLICY,
      WEEKEND,
    );

    expect(result.settlementAmount).toEqual(money(2_156_350n, "USDC"));
  });

  test("a zero spread leaves the rate exactly as the oracle published it", async () => {
    const result = await priceInSettlement(
      oracle(fridayClose()),
      money(35_000_00n, "IDR"),
      "USDC",
      { ...WEEKEND_POLICY, closedSpreadBps: 0 },
      WEEKEND,
    );

    expect(result.settlementAmount).toEqual(money(2_135_000n, "USDC"));
    expect(result.kind).toBe("oracle-closed");
  });

  test("USD/USDC is a 1:1 peg, so a USD price rescales into USDC — not widened", async () => {
    // A USDC-settling deployment that prices in USD declares the pair pegged:
    // it is the same currency in two representations (2-decimal fiat into
    // 6-decimal stablecoin), not an FX rate. The weekend spread below is for a
    // floating pair with a gap risk; a peg has none, and widening it would
    // charge a USD-priced merchant 75 bps of phantom FX over a weekend.
    const result = await priceInSettlement(
      oracle(),
      money(100_00n, "USD"), // $100.00
      "USDC",
      WEEKEND_POLICY,
      WEEKEND,
    );

    expect(result.kind).toBe("pegged");
    expect(result.source).toBe("peg");
    // $100.00 (2 dp) rescales to 100 USDC (6 dp): 10_000 minor × 10^4 = 100_000_000.
    expect(result.settlementAmount).toEqual(money(100_000_000n, "USDC"));
  });

  test("refuses a negative spread — that would short the merchant", async () => {
    await expect(
      priceInSettlement(
        oracle(fridayClose()),
        money(35_000_00n, "IDR"),
        "USDC",
        { ...WEEKEND_POLICY, closedSpreadBps: -100 },
        WEEKEND,
      ),
    ).rejects.toThrow(ConfigurationError);
  });
});

describe("priceInSettlement — boundaries", () => {
  test("refuses a non-fiat price — this leg is the fiat crossing", async () => {
    await expect(
      priceInSettlement(oracle(), money(1_000_000n, "USDC"), "USDT", POLICY, NOW),
    ).rejects.toThrow(ConfigurationError);
  });

  test("refuses a non-stablecoin settlement asset", async () => {
    await expect(
      priceInSettlement(oracle(), money(35_000_00n, "IDR"), "ETH", POLICY, NOW),
    ).rejects.toThrow(ConfigurationError);
  });

  test("refuses a non-positive price", async () => {
    await expect(
      priceInSettlement(oracle(), money(0n, "IDR"), "USDC", POLICY, NOW),
    ).rejects.toThrow(ValidationError);
  });
});

describe("fiatPairKey", () => {
  test("matches the key shape the rate table and oracle feeds use", () => {
    expect(fiatPairKey("USD", "USDC")).toBe("USD/USDC");
  });
});
