import { describe, expect, test } from "bun:test";
import { money, ValidationError } from "@mayarin/shared";
import { CART_METADATA_KEY, cartSnapshot, priceCart, withCartSnapshot } from "../src/cart.ts";
import type { CartLine } from "../src/types.ts";

const coffee: CartLine = {
  productId: "prd_1",
  name: "Kopi",
  unitPrice: money(2_500_000n, "IDR"),
  quantity: 3,
};
const bread: CartLine = { name: "Roti", unitPrice: money(1_200_000n, "IDR"), quantity: 1 };

describe("priceCart", () => {
  test("folds lines into a single total", () => {
    const total = priceCart([coffee, bread], "IDR");
    expect(total.total).toEqual(money(8_700_000n, "IDR"));
  });

  test("rejects an empty cart", () => {
    expect(() => priceCart([], "IDR")).toThrow(ValidationError);
  });

  test("rejects a line priced in another currency rather than converting it", () => {
    const usd: CartLine = { name: "Import", unitPrice: money(100n, "USD"), quantity: 1 };
    expect(() => priceCart([coffee, usd], "IDR")).toThrow(ValidationError);
  });

  test("rejects a non-positive quantity", () => {
    expect(() => priceCart([{ ...coffee, quantity: 0 }], "IDR")).toThrow(ValidationError);
  });

  test("rejects a fractional quantity", () => {
    expect(() => priceCart([{ ...coffee, quantity: 1.5 }], "IDR")).toThrow(ValidationError);
  });

  test("rejects a non-positive unit price", () => {
    expect(() => priceCart([{ ...bread, unitPrice: money(0n, "IDR") }], "IDR")).toThrow(
      ValidationError,
    );
  });

  test("rejects a cart large enough to be a payload", () => {
    const lines = Array.from({ length: 201 }, () => bread);
    expect(() => priceCart(lines, "IDR")).toThrow(ValidationError);
  });
});

describe("cartSnapshot", () => {
  test("records exact minor units, not a rendered amount", () => {
    const snapshot = JSON.parse(cartSnapshot(priceCart([coffee, bread], "IDR")));
    expect(snapshot).toEqual({
      currency: "IDR",
      total: "8700000",
      lines: [
        { productId: "prd_1", name: "Kopi", unitPrice: "2500000", quantity: 3 },
        { name: "Roti", unitPrice: "1200000", quantity: 1 },
      ],
    });
  });

  test("merges under a reserved key without dropping caller metadata", () => {
    const metadata = withCartSnapshot({ table: "12" }, priceCart([bread], "IDR"));
    expect(metadata.table).toBe("12");
    expect(metadata[CART_METADATA_KEY]).toContain('"total":"1200000"');
  });
});
