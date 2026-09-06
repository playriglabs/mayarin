import { describe, expect, test } from "bun:test";
import { ASSET_CODES, assetLogoUrl, getAsset } from "../src/asset.ts";

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
