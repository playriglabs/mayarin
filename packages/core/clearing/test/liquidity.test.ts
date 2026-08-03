import { describe, expect, test } from "bun:test";
import { type AssetCode, money } from "@mayarin/shared";
import type { PriceQuote, PriceSource } from "../src/liquidity.ts";

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
