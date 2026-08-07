import { describe, expect, test } from "bun:test";
import type { PriceQuote } from "@mayarin/clearing";
import { ConfigurationError, money, ValidationError } from "@mayarin/shared";
import { planSwap, priceSourceOf } from "../src/index.ts";
import { FixedSwapVenue } from "../testing/index.ts";

const ETH_USDC: PriceQuote = {
  from: "ETH",
  to: "USDC",
  scaledRate: 3_700_000_000n,
  source: "0x",
};

function venue(quotes: readonly PriceQuote[] = [ETH_USDC]) {
  return new FixedSwapVenue("0x", quotes);
}

describe("planSwap", () => {
  test("equal assets make a no-swap plan and call no venue", async () => {
    const v = venue();
    const plan = await planSwap(v, "USDC", "USDC", money(1_000_000n, "USDC"));

    expect(plan).toEqual({ kind: "no-swap", asset: "USDC" });
    expect(v.calls).toHaveLength(0);
  });

  test("different assets make a swap plan with the venue quote and the venue name", async () => {
    const v = venue();
    const plan = await planSwap(v, "ETH", "USDC", money(10n ** 18n, "ETH"));

    expect(plan.kind).toBe("swap");
    if (plan.kind !== "swap") throw new Error("expected a swap plan");
    expect(plan.venue).toBe("0x");
    expect(plan.quote).toEqual(ETH_USDC);
    expect(plan.payerAsset).toBe("ETH");
    expect(plan.settlementAsset).toBe("USDC");
  });

  test("the amount flows to the venue, for size-aware quotes", async () => {
    const v = venue();
    await planSwap(v, "ETH", "USDC", money(5n * 10n ** 17n, "ETH"));

    expect(v.calls).toEqual([{ from: "ETH", to: "USDC", amount: 5n * 10n ** 17n }]);
  });

  test("an amount in a different asset than the payer asset is refused", async () => {
    expect(planSwap(venue(), "ETH", "USDC", money(1_000_000n, "USDC"))).rejects.toThrow(
      ValidationError,
    );
  });

  test("a pair that the venue cannot serve propagates ConfigurationError", async () => {
    expect(planSwap(venue([]), "ETH", "USDC", money(10n ** 18n, "ETH"))).rejects.toThrow(
      ConfigurationError,
    );
  });
});

describe("priceSourceOf", () => {
  test("the PriceSource view returns the venue quote", async () => {
    const v = venue();
    const source = priceSourceOf(v);

    const priced = await source.price("ETH", "USDC", money(10n ** 18n, "ETH"));
    expect(priced).toEqual(ETH_USDC);
    expect(v.calls).toHaveLength(1);
  });
});
