import { describe, expect, test } from "bun:test";
import { money, ValidationError } from "@mayarin/shared";
import { priceIn } from "../src/cart.ts";
import { createProduct, updateProduct } from "../src/product.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function product() {
  return createProduct({
    merchantId: "mrc_1",
    sku: "KOPI-01",
    name: "Kopi Susu",
    prices: [money(2_500_000n, "IDR"), money(750n, "MYR")],
    now: NOW,
  });
}

describe("createProduct", () => {
  test("prices in several currencies at once", () => {
    expect(priceIn(product().prices, "MYR")).toEqual(money(750n, "MYR"));
  });

  test("has no price in a currency the merchant did not enter", () => {
    expect(priceIn(product().prices, "THB")).toBeUndefined();
  });

  test("starts active, at version 1", () => {
    expect(product().active).toBe(true);
    expect(product().version).toBe(1);
  });

  test("refuses a product with no price at all", () => {
    expect(() =>
      createProduct({ merchantId: "mrc_1", sku: "X", name: "X", prices: [], now: NOW }),
    ).toThrow(ValidationError);
  });

  test("refuses two prices in the same currency", () => {
    expect(() =>
      createProduct({
        merchantId: "mrc_1",
        sku: "X",
        name: "X",
        prices: [money(1n, "IDR"), money(2n, "IDR")],
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });

  test("refuses a non-positive price", () => {
    expect(() =>
      createProduct({
        merchantId: "mrc_1",
        sku: "X",
        name: "X",
        prices: [money(0n, "IDR")],
        now: NOW,
      }),
    ).toThrow(ValidationError);
  });
});

describe("updateProduct", () => {
  test("returns a new value and bumps the version", () => {
    const original = product();
    const next = updateProduct(original, { name: "Kopi Susu Gula Aren" }, NOW);
    expect(next.version).toBe(2);
    expect(original.name).toBe("Kopi Susu");
  });

  test("retiring a product leaves it readable", () => {
    const retired = updateProduct(product(), { active: false }, NOW);
    expect(retired.active).toBe(false);
    expect(priceIn(retired.prices, "IDR")).toEqual(money(2_500_000n, "IDR"));
  });

  test("validates a replacement price set", () => {
    expect(() => updateProduct(product(), { prices: [money(-1n, "IDR")] }, NOW)).toThrow(
      ValidationError,
    );
  });
});
