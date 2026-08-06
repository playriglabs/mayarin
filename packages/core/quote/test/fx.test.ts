import { describe, expect, test } from "bun:test";
import type { OraclePrice, PriceOracle } from "@mayarin/clearing";
import { FixedPriceOracle } from "@mayarin/clearing/testing";
import { ConfigurationError, money, ProviderError, ValidationError } from "@mayarin/shared";
import { fiatPairKey, priceInSettlement } from "../src/fx.ts";

const NOW = new Date("2026-08-06T12:00:00.000Z");
const POLICY = { pegged: ["IDR/IDRX"], maxAgeMs: 60_000 } as const;

/** IDR 1 = 0.0000615 USDC — 6-dec USDC, so 61 minor units per whole IDR. */
function idrUsdc(overrides: Partial<OraclePrice> = {}): OraclePrice {
  return {
    from: "IDR",
    to: "USDC",
    minorUnitsPerWholeUnit: 61n,
    source: "pyth",
    observedAt: NOW,
    ...overrides,
  };
}

function oracle(price: OraclePrice = idrUsdc()): PriceOracle {
  return new FixedPriceOracle([price]);
}

describe("priceInSettlement — pegged pairs", () => {
  test("IDR into IDRX is a decimal rescale, not an exchange rate", async () => {
    // Both are 2-decimal, so the minor units carry across unchanged. Routing
    // this through USD would add two rounding steps to an exact answer.
    const result = await priceInSettlement(
      oracle(),
      money(35_000_00n, "IDR"), // Rp 35.000,00
      "IDRX",
      POLICY,
      NOW,
    );

    expect(result.kind).toBe("pegged");
    expect(result.source).toBe("peg");
    expect(result.settlementAmount).toEqual(money(35_000_00n, "IDRX"));
    expect(result.observedAt).toBeUndefined();
  });

  test("a pegged pair never consults the oracle — nothing to go stale", async () => {
    const stale = oracle(idrUsdc({ observedAt: new Date(NOW.getTime() - 3_600_000) }));
    const result = await priceInSettlement(stale, money(35_000_00n, "IDR"), "IDRX", POLICY, NOW);
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

describe("priceInSettlement — boundaries", () => {
  test("refuses a non-fiat price — this leg is the fiat crossing", async () => {
    await expect(
      priceInSettlement(oracle(), money(1_000_000n, "USDC"), "IDRX", POLICY, NOW),
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
    expect(fiatPairKey("IDR", "IDRX")).toBe("IDR/IDRX");
  });
});
