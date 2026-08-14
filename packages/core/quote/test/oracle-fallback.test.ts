import { describe, expect, test } from "bun:test";
import type { OraclePrice, PriceOracle } from "@mayarin/clearing";
import { FixedClock, ProviderError } from "@mayarin/shared";
import { FallbackPriceOracle } from "../src/oracle-fallback.ts";

const NOW = new Date("2026-08-14T03:42:00.000Z");

function price(
  source: string,
  rate: bigint,
  ageMs = 0,
  pair: readonly [OraclePrice["from"], OraclePrice["to"]] = ["IDR", "USDC"],
): OraclePrice {
  return {
    from: pair[0],
    to: pair[1],
    scaledRate: rate,
    source,
    observedAt: new Date(NOW.getTime() - ageMs),
  };
}

function oracle(result: OraclePrice | Error): PriceOracle {
  return {
    reference: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

function fallback(primary: OraclePrice | Error, secondary: OraclePrice | Error) {
  return new FallbackPriceOracle({
    sources: [
      { name: "primary", oracle: oracle(primary) },
      { name: "secondary", oracle: oracle(secondary) },
    ],
    clock: new FixedClock(NOW),
    maxAgeMs: () => 300_000,
    maxDeviationBps: 100,
  });
}

describe("FallbackPriceOracle", () => {
  test("keeps the configured primary when both references are fresh and agree", async () => {
    const reference = await fallback(
      price("pyth", 56_000_000_000n),
      price("backup", 56_100_000_000n),
    ).reference("IDR", "USDC");
    expect(reference.source).toBe("pyth");
  });

  test("uses a fresh secondary when the primary is stale", async () => {
    const reference = await fallback(
      price("pyth", 56_000_000_000n, 8_000_000),
      price("backup", 56_100_000_000n),
    ).reference("IDR", "USDC");
    expect(reference.source).toBe("backup");
  });

  test("uses a fresh secondary when the primary request fails", async () => {
    const reference = await fallback(
      new ProviderError("pyth unavailable"),
      price("backup", 56_100_000_000n),
    ).reference("IDR", "USDC");
    expect(reference.source).toBe("backup");
  });

  test("applies to every configured pair, including SGD and crypto references", async () => {
    const sgd = await fallback(
      price("pyth", 770_000_000_000n, 8_000_000, ["SGD", "USDC"]),
      price("backup", 771_000_000_000n, 0, ["SGD", "USDC"]),
    ).reference("SGD", "USDC");
    const eth = await fallback(
      price("pyth", 3_500_000_000_000_000n, 8_000_000, ["ETH", "USDC"]),
      price("backup", 3_501_000_000_000_000n, 0, ["ETH", "USDC"]),
    ).reference("ETH", "USDC");

    expect([sgd.source, eth.source]).toEqual(["backup", "backup"]);
  });

  test("fails closed when every source is stale or unavailable", async () => {
    expect(
      fallback(
        price("pyth", 56_000_000_000n, 8_000_000),
        new Error("backup unavailable"),
      ).reference("IDR", "USDC"),
    ).rejects.toThrow("No fresh oracle price");
  });

  test("fails closed when fresh sources materially disagree", async () => {
    expect(
      fallback(price("pyth", 56_000_000_000n), price("backup", 60_000_000_000n)).reference(
        "IDR",
        "USDC",
      ),
    ).rejects.toThrow("Oracle sources disagree");
  });
});
