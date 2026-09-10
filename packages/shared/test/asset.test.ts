import { describe, expect, test } from "bun:test";
import {
  ASSET_CODES,
  assetFromIso4217Numeric,
  assetLogoUrl,
  assetSymbol,
  getAsset,
  isDustAmount,
} from "../src/asset.ts";

const FIAT_CURRENCIES = {
  IDR: { numeric: "360", symbol: "Rp" },
  SGD: { numeric: "702", symbol: "S$" },
  MYR: { numeric: "458", symbol: "RM" },
  THB: { numeric: "764", symbol: "฿" },
  PHP: { numeric: "608", symbol: "₱" },
  VND: { numeric: "704", symbol: "₫" },
  BND: { numeric: "096", symbol: "B$" },
  MMK: { numeric: "104", symbol: "K" },
  KHR: { numeric: "116", symbol: "៛" },
  LAK: { numeric: "418", symbol: "₭" },
  USD: { numeric: "840", symbol: "$" },
  JPY: { numeric: "392", symbol: "¥" },
  CNY: { numeric: "156", symbol: "CN¥" },
  HKD: { numeric: "344", symbol: "HK$" },
  EUR: { numeric: "978", symbol: "€" },
  GBP: { numeric: "826", symbol: "£" },
  AUD: { numeric: "036", symbol: "A$" },
  CAD: { numeric: "124", symbol: "C$" },
  AED: { numeric: "784", symbol: "د.إ" },
  SAR: { numeric: "682", symbol: "ر.س" },
  BRL: { numeric: "986", symbol: "R$" },
  MXN: { numeric: "484", symbol: "MX$" },
} as const;

describe("fiat registry", () => {
  test("exposes every supported currency with its dashboard symbol and ISO numeric code", () => {
    for (const code of Object.keys(FIAT_CURRENCIES) as (keyof typeof FIAT_CURRENCIES)[]) {
      const expected = FIAT_CURRENCIES[code];
      expect(getAsset(code).kind).toBe("fiat");
      expect(assetSymbol(code)).toBe(expected.symbol);
      expect(assetFromIso4217Numeric(expected.numeric)).toBe(code);
    }
  });

  test("includes twenty-two fiat pricing currencies", () => {
    expect(ASSET_CODES.filter((code) => getAsset(code).kind === "fiat")).toHaveLength(22);
  });
});

describe("asset logos", () => {
  test("every registered on-chain asset has a logo", () => {
    const tokens = ASSET_CODES.filter((code) => getAsset(code).kind !== "fiat");
    for (const token of tokens) {
      expect(assetLogoUrl(token)).toBeDefined();
    }
  });

  test("non-USDT tokens use Trust Wallet's CDN, USDT uses a transparent local mark", () => {
    const tokens = ASSET_CODES.filter((code) => getAsset(code).kind !== "fiat" && code !== "USDT");
    for (const token of tokens) {
      expect(assetLogoUrl(token)?.startsWith("https://assets-cdn.trustwallet.com/")).toBe(true);
    }
    // Trust Wallet's USDT PNG ships without an alpha channel, so it is overridden.
    expect(assetLogoUrl("USDT")).toBe("/tokens/usdt.svg");
    expect(assetLogoUrl("USDT", "/assets/usdt.svg")).toBe("/assets/usdt.svg");
  });

  test("keeps token artwork ready and leaves fiat to the UI fallback", () => {
    expect(assetLogoUrl("EURC")?.startsWith("https://assets-cdn.trustwallet.com/")).toBe(true);
    expect(assetLogoUrl("PYUSD")?.startsWith("https://assets-cdn.trustwallet.com/")).toBe(true);
    expect(assetLogoUrl("IDR")).toBeUndefined();
  });
});

describe("dust", () => {
  test("one cent of a stablecoin is dust, two are not", () => {
    // The threshold is inclusive: at exactly the line the change is worth the
    // same as returning it, and the tie goes to not sending a transaction.
    expect(isDustAmount("EURC", 9_999n)).toBe(true);
    expect(isDustAmount("EURC", 10_000n)).toBe(true);
    expect(isDustAmount("EURC", 10_001n)).toBe(false);
    expect(isDustAmount("USDC", 10_000n)).toBe(true);
    expect(isDustAmount("USDT", 10_000n)).toBe(true);
  });

  test("an asset that has not declared a threshold keeps every amount", () => {
    // Absent is not zero and not infinity: it means no policy has been set, and
    // no policy means the payer's money is owed back however small it is.
    // ETH cannot reach this path at all — it has no EIP-3009 — so declaring a
    // number for it would be a guess with somebody else's money.
    expect(isDustAmount("ETH", 1n)).toBe(false);
    expect(isDustAmount("BTC", 1n)).toBe(false);
    expect(isDustAmount("IDR", 1n)).toBe(false);
  });
});
