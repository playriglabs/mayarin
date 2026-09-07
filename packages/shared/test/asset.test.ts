import { describe, expect, test } from "bun:test";
import { ASSET_CODES, assetLogoUrl, getAsset, isDustAmount } from "../src/asset.ts";

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

  test("keeps the EURC artwork ready and leaves fiat to the UI fallback", () => {
    expect(assetLogoUrl("EURC")?.startsWith("https://assets-cdn.trustwallet.com/")).toBe(true);
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
