import { describe, expect, test } from "bun:test";
import { type AssetCode, ConfigurationError, money } from "@mayarin/shared";
import { type PriceQuote, type PriceSource, TablePriceSource } from "../src/liquidity.ts";

/** A stub source that records its arguments and returns a fixed quote. */
class StubSource implements PriceSource {
  readonly calls: Array<{ from: AssetCode; to: AssetCode; amount: bigint }> = [];

  async price(from: AssetCode, to: AssetCode, amount: { amount: bigint }): Promise<PriceQuote> {
    this.calls.push({ from, to, amount: amount.amount });
    return {
      from,
      to,
      minorUnitsPerWholeUnit: 100n,
      source: "stub",
    };
  }
}

describe("PriceSource port", () => {
  test("price returns a PriceQuote shaped from/to/minorUnitsPerWholeUnit/source", async () => {
    const source = new StubSource();
    const quote = await source.price("IDRX", "USDC", money(1_000n, "IDRX"));

    expect(quote.from).toBe("IDRX");
    expect(quote.to).toBe("USDC");
    expect(quote.minorUnitsPerWholeUnit).toBe(100n);
    expect(quote.source).toBe("stub");
    expect(quote.expiresAt).toBeUndefined();
  });

  test("price receives the amount being priced", async () => {
    const source = new StubSource();
    await source.price("IDRX", "USDC", money(5_000n, "IDRX"));
    expect(source.calls[0]?.amount).toBe(5_000n);
  });
});

describe("TablePriceSource", () => {
  const source = new TablePriceSource({ "IDRX/USDC": 100_0000n });

  test("returns the configured rate for a cross-asset pair", async () => {
    const quote = await source.price("IDRX", "USDC", money(10_000n, "IDRX"));
    expect(quote.minorUnitsPerWholeUnit).toBe(100_0000n);
    expect(quote.source).toBe("table");
    expect(quote.from).toBe("IDRX");
    expect(quote.to).toBe("USDC");
  });

  test("throws on a missing cross-asset pair", async () => {
    await expect(source.price("USDC", "IDRX", money(1_000_000n, "USDC"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("throws on a same-asset pair — identity is the router's job", async () => {
    await expect(source.price("IDRX", "IDRX", money(10_000n, "IDRX"))).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("carries a custom source label", async () => {
    const labelled = new TablePriceSource({ "IDRX/USDC": 100_0000n }, "exchange-rates");
    const quote = await labelled.price("IDRX", "USDC", money(10_000n, "IDRX"));
    expect(quote.source).toBe("exchange-rates");
  });
});
