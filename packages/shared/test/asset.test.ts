import { describe, expect, test } from "bun:test";
import { ASSET_CODES, assetLogoUrl, getAsset } from "../src/asset.ts";

describe("asset logos", () => {
  test("every registered on-chain asset uses Trust Wallet's CDN", () => {
    const tokens = ASSET_CODES.filter((code) => getAsset(code).kind !== "fiat");
    for (const token of tokens) {
      expect(assetLogoUrl(token)?.startsWith("https://assets-cdn.trustwallet.com/")).toBe(true);
    }
  });

  test("keeps the EURC artwork ready and leaves fiat to the UI fallback", () => {
    expect(assetLogoUrl("EURC")?.startsWith("https://assets-cdn.trustwallet.com/")).toBe(true);
    expect(assetLogoUrl("IDR")).toBeUndefined();
  });
});
