import { describe, expect, test } from "bun:test";
import { getAsset, isAssetCode } from "@mayarin/shared";
import { availableMarkets, MARKETS, pickMarket } from "../features/pay/markets.ts";

describe("availableMarkets", () => {
  test("keeps only the currencies the provider can take, in table order", () => {
    // USD and the CFA franc are not a single country, so they are no market.
    const markets = availableMarkets(["MYR", "USD", "PHP", "XOF"]);

    expect(markets.map((market) => market.currency)).toEqual(["PHP", "MYR"]);
  });

  test("is empty when the provider takes none of them", () => {
    expect(availableMarkets(["USD", "EUR"])).toEqual([]);
  });

  test("markets outside Southeast Asia are in the same table", () => {
    const markets = availableMarkets(["BRL", "MXN", "PHP"]);

    expect(markets.map((market) => market.country)).toEqual(["PH", "BR", "MX"]);
  });

  test("a market becomes available by being listed, with no change to the table", () => {
    expect(availableMarkets(["THB"]).map((market) => market.country)).toEqual(["TH"]);
  });
});

describe("pickMarket", () => {
  const markets = availableMarkets(["PHP", "IDR", "MYR", "THB"]);

  test("the price currency wins when it is on offer", () => {
    expect(pickMarket(markets, { currency: "IDR", locale: "en-PH" })?.country).toBe("ID");
  });

  test("otherwise the browser's region", () => {
    expect(pickMarket(markets, { currency: "USD", locale: "en-TH" })?.country).toBe("TH");
  });

  test("otherwise the browser's language", () => {
    expect(pickMarket(markets, { locale: "ms" })?.country).toBe("MY");
    expect(pickMarket(markets, { locale: "fil" })?.country).toBe("PH");
  });

  test("otherwise the first on offer", () => {
    expect(pickMarket(markets, { currency: "USD", locale: "en-US" })?.country).toBe("PH");
  });

  test("nothing on offer is nothing to pick", () => {
    expect(pickMarket([], { currency: "IDR" })).toBeUndefined();
  });
});

describe("MARKETS", () => {
  test("every market has its own currency and country", () => {
    expect(new Set(MARKETS.map((market) => market.currency)).size).toBe(MARKETS.length);
    expect(new Set(MARKETS.map((market) => market.country)).size).toBe(MARKETS.length);
  });
});

describe("MARKETS and the platform's currencies", () => {
  test("every market's currency is a fiat asset Mayarin supports", () => {
    for (const market of MARKETS) {
      expect(isAssetCode(market.currency)).toBe(true);
      expect(getAsset(market.currency as never).kind).toBe("fiat");
    }
  });
});
