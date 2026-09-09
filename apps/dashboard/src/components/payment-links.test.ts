import { describe, expect, test } from "bun:test";
import {
  catalogCurrencies,
  displayedRailsForLink,
  paymentRailsForLink,
  primaryCatalogCurrency,
  railChipSummary,
} from "./payment-links.tsx";

describe("catalog payment-link currency", () => {
  test("comes from the selected product's primary price", () => {
    const products = [
      { id: "product-usd", prices: [{ asset: "USD" }] },
      { id: "product-idr", prices: [{ asset: "IDR" }] },
    ] as const;

    expect(primaryCatalogCurrency(products, "product-usd")).toBe("USD");
    expect(primaryCatalogCurrency(products, "product-idr")).toBe("IDR");
  });

  test("returns no currency when the product has no price", () => {
    expect(primaryCatalogCurrency([{ id: "unpriced", prices: [] }], "unpriced")).toBeUndefined();
    expect(primaryCatalogCurrency([], "missing")).toBeUndefined();
  });

  test("offers every explicit price when a product has multiple currencies", () => {
    const products = [
      { id: "multi-currency", prices: [{ asset: "SGD" }, { asset: "USD" }] },
    ] as const;

    expect(catalogCurrencies(products, "multi-currency")).toEqual(["SGD", "USD"]);
  });
});

describe("payment-link rails", () => {
  const rails = [
    { chain: "base-sepolia", asset: "USDC", contract: "0xusdc", payTo: "0xmerchant" },
    { chain: "base-sepolia", asset: "ETH", contract: null, payTo: "0xmerchant" },
  ] as const;

  test("an unrestricted link uses every live merchant rail", () => {
    expect(paymentRailsForLink(rails, null)).toEqual(rails);
  });

  test("a restricted link exposes only the selected pair", () => {
    expect(paymentRailsForLink(rails, [{ chain: "base-sepolia", asset: "USDC" }])).toEqual([
      rails[0],
    ]);
  });

  test("a selected rail that is no longer live does not widen the merchant catalog", () => {
    expect(paymentRailsForLink(rails, [{ chain: "arc-testnet", asset: "USDC" }])).toEqual([]);
  });

  test("shows the configured pairs even when one is no longer live", () => {
    const configured = [{ chain: "arc-testnet", asset: "USDC" }] as const;
    expect(displayedRailsForLink(rails, configured)).toEqual(configured);
  });

  test("an unrestricted link shows the merchant's current rail pairs", () => {
    expect(displayedRailsForLink(rails, null)).toEqual([
      { chain: "base-sepolia", asset: "USDC" },
      { chain: "base-sepolia", asset: "ETH" },
    ]);
  });

  test("does not render a repeated configured pair twice", () => {
    expect(
      displayedRailsForLink(rails, [
        { chain: "base-sepolia", asset: "USDC" },
        { chain: "base-sepolia", asset: "USDC" },
      ]),
    ).toEqual([{ chain: "base-sepolia", asset: "USDC" }]);
  });

  test("the compact table shows two rails and counts the rest", () => {
    expect(
      railChipSummary([
        { chain: "base-sepolia", asset: "USDC" },
        { chain: "arc-testnet", asset: "EURC" },
        { chain: "arc-testnet", asset: "USDC" },
        { chain: "base-sepolia", asset: "ETH" },
      ]),
    ).toEqual({
      shown: [
        { chain: "base-sepolia", asset: "USDC" },
        { chain: "arc-testnet", asset: "EURC" },
      ],
      remaining: 2,
    });
  });
});
