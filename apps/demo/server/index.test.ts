import { describe, expect, test } from "bun:test";
import { cartCheckoutBody, type DemoConfig, parseCheckoutRequest } from "./api.ts";

const config: DemoConfig = {
  apiUrl: "https://api.test",
  merchant: { id: "mrc_1", name: "Parahyangan Supply", city: "Bandung", countryCode: "ID" },
  secretKey: "sk_test",
  publicUrl: "https://store.test",
};

describe("parseCheckoutRequest", () => {
  test("accepts an order id with positive integer quantities", () => {
    expect(
      parseCheckoutRequest({
        orderId: "01K3XYZ",
        lines: [{ productId: "prod_1", quantity: 2 }],
      }),
    ).toEqual({ orderId: "01K3XYZ", lines: [{ productId: "prod_1", quantity: 2 }] });
  });

  test("refuses a checkout with no order id", () => {
    expect(parseCheckoutRequest({ lines: [{ productId: "prod_1", quantity: 1 }] })).toBeUndefined();
  });

  test("refuses empty, fractional, and non-positive lines", () => {
    expect(parseCheckoutRequest({ orderId: "o1", lines: [] })).toBeUndefined();
    expect(
      parseCheckoutRequest({ orderId: "o1", lines: [{ productId: "prod_1", quantity: 1.5 }] }),
    ).toBeUndefined();
    expect(
      parseCheckoutRequest({ orderId: "o1", lines: [{ productId: "prod_1", quantity: 0 }] }),
    ).toBeUndefined();
  });
});

describe("cartCheckoutBody", () => {
  test("carries the order id as the merchant reference", () => {
    const body = cartCheckoutBody(config, {
      orderId: "01K3XYZ",
      lines: [{ productId: "prod_1", quantity: 1 }],
    });

    expect(body.merchantReference).toBe("01K3XYZ");
    expect(body.currency).toBe("IDR");
    expect(body.merchant).toEqual(config.merchant);
    expect(body.metadata).toEqual({
      checkoutSuccessBaseUrl: "https://store.test/checkout/success",
    });
  });

  test("sends nothing about the buyer beyond the lines", () => {
    const body = cartCheckoutBody(config, {
      orderId: "01K3XYZ",
      lines: [{ productId: "prod_1", quantity: 1 }],
    });

    expect(Object.keys(body).sort()).toEqual([
      "currency",
      "lines",
      "merchant",
      "merchantReference",
      "metadata",
    ]);
  });
});
