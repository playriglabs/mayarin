import { describe, expect, test } from "bun:test";
import { primaryCatalogCurrency } from "./payment-links.tsx";

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
});
