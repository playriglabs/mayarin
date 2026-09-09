import { describe, expect, test } from "bun:test";
import { ASSET_CODES, getAsset } from "@mayarin/shared";
import { CURRENCY_MARKETS } from "../src/components/landing/currency-markets.ts";

describe("landing currency coverage", () => {
  test("covers every fiat asset exactly once", () => {
    const fiatCodes = ASSET_CODES.filter((code) => getAsset(code).kind === "fiat").sort();
    const marketCodes = CURRENCY_MARKETS.map(({ code }) => code).sort();

    expect(marketCodes).toEqual(fiatCodes);
  });

  test("uses a unique globe marker for every currency market", () => {
    const ids = CURRENCY_MARKETS.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
