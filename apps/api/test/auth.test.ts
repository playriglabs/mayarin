/**
 * API-key auth tests (#14).
 *
 * What matters here is the boundary: which routes demand a key, which stay
 * open for buyers, and that a key never reaches across to another merchant.
 */

import { describe, expect, test } from "bun:test";
import { deactivateApiKey } from "@mayarin/auth";
import { createApiHarness, TEST_MERCHANT_ID } from "./harness.ts";

const merchant = { id: TEST_MERCHANT_ID, name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };

function productBody(merchantId = TEST_MERCHANT_ID) {
  return {
    merchantId,
    sku: "KOPI-1",
    name: "Kopi Susu",
    prices: [{ amount: "25000.00", asset: "IDR" }],
  };
}

describe("routes that require a key", () => {
  test("no key is a 401 with the UNAUTHORIZED code", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", {
      auth: false,
      body: { merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("an unknown secret gets the same 401 as no key at all", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", {
      auth: "mak_never_minted",
      body: { merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    expect(status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("a deactivated key stops working", async () => {
    const harness = createApiHarness();
    const secret = harness.mintApiKey("mrc_2", "mak_soon_revoked");
    const [key] = await harness.apiKeys.listByMerchant("mrc_2");
    if (key === undefined) throw new Error("the minted key must exist");
    await harness.apiKeys.update(deactivateApiKey(key, new Date()), key.version);

    const { status } = await harness.request("POST", "/v1/payment-intents", {
      auth: secret,
      body: { merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    expect(status).toBe(401);
  });

  test("a refund needs a key", async () => {
    const harness = createApiHarness();
    const { status } = await harness.request("POST", "/v1/payments/pi_anything/refunds", {
      auth: false,
      body: {},
    });
    expect(status).toBe(401);
  });
});

describe("permissions", () => {
  test("a key without catalog:manage cannot write the catalog", async () => {
    const harness = createApiHarness();
    const secret = harness.mintApiKey(TEST_MERCHANT_ID, "mak_read_only", ["payments:read"]);

    const { status, body } = await harness.request("POST", "/v1/catalog/products", {
      auth: secret,
      body: productBody(),
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");

    // The same key can still mint an intent: taking a payment is not managing
    // the catalog.
    const intent = await harness.request("POST", "/v1/payment-intents", {
      auth: secret,
      body: { merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    expect(intent.status).toBe(201);
  });
});

describe("tenant boundaries", () => {
  test("naming another merchant in the body is a 403", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/catalog/products", {
      body: productBody("mrc_somebody_else"),
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  test("another merchant's product answers 404, not 403", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/catalog/products", { body: productBody() });
    expect(created.status).toBe(201);

    const foreign = harness.mintApiKey("mrc_2", "mak_other_merchant");
    const { status, body } = await harness.request(
      "PATCH",
      `/v1/catalog/products/${created.body.product.id}`,
      { auth: foreign, body: { name: "Not yours" } },
    );
    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("a listing defaults to the key's own merchant and refuses another's", async () => {
    const harness = createApiHarness();
    await harness.request("POST", "/v1/catalog/products", { body: productBody() });

    const own = await harness.request("GET", "/v1/catalog/products");
    expect(own.status).toBe(200);
    expect(own.body.products).toHaveLength(1);

    const foreign = await harness.request("GET", "/v1/catalog/products?merchantId=mrc_2");
    expect(foreign.status).toBe(403);
  });

  test("another merchant's invoice cannot be issued", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/invoices", {
      body: {
        merchantId: TEST_MERCHANT_ID,
        merchant,
        buyer: { name: "Budi" },
        currency: "IDR",
        lines: [{ name: "Kopi", quantity: 1, unitPrice: { amount: "25000.00", asset: "IDR" } }],
      },
    });
    expect(created.status).toBe(201);

    const foreign = harness.mintApiKey("mrc_2", "mak_other_merchant");
    const { status } = await harness.request(
      "POST",
      `/v1/invoices/${created.body.invoice.id}/issue`,
      {
        auth: foreign,
        body: {},
      },
    );
    expect(status).toBe(404);
  });
});

describe("buyer routes stay open", () => {
  test("a buyer pays a link, confirms, and polls with no key", async () => {
    const harness = createApiHarness();
    const link = await harness.request("POST", "/v1/payment-links", {
      body: {
        kind: "fixed",
        merchant,
        amount: { amount: "50000.00", asset: "IDR" },
      },
    });
    expect(link.status).toBe(201);

    const checkout = await harness.request(
      "POST",
      `/v1/payment-links/${link.body.paymentLink.id}/checkout`,
      { auth: false, body: {} },
    );
    expect(checkout.status).toBe(201);

    const intentId = checkout.body.paymentIntent.id;
    const confirmed = await harness.request("POST", `/v1/payment-intents/${intentId}/confirm`, {
      auth: false,
    });
    expect(confirmed.status).toBe(200);

    const polled = await harness.request("GET", `/v1/payments/${intentId}`, { auth: false });
    expect(polled.status).toBe(200);
  });
});

describe("publishable keys (#113)", () => {
  const PK = "pk_test_publishable";
  const mintPk = (harness: ReturnType<typeof createApiHarness>, merchantId = TEST_MERCHANT_ID) =>
    harness.mintApiKey(merchantId, PK, [], "publishable");

  test("lists the catalog for its own merchant", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/catalog/products", {
      body: productBody(),
    });
    expect(created.status).toBe(201);

    mintPk(harness);
    const { status, body } = await harness.request("GET", "/v1/catalog/products", { auth: PK });
    expect(status).toBe(200);
    expect(body.products).toHaveLength(1);
  });

  test("checks out a cart for its own merchant", async () => {
    const harness = createApiHarness();
    mintPk(harness);
    const { status, body } = await harness.request("POST", "/v1/carts/checkout", {
      auth: PK,
      body: {
        merchant,
        currency: "IDR",
        lines: [{ name: "Roti", unitPrice: { amount: "12000.00", asset: "IDR" }, quantity: 1 }],
      },
    });
    expect(status).toBe(201);
    expect(body.paymentIntent.status).toBe("CREATED");
  });

  test("cannot reach another merchant's catalog or checkout", async () => {
    const harness = createApiHarness();
    mintPk(harness, "mrc_other");

    // The query names TEST_MERCHANT_ID; the key belongs to mrc_other.
    const listed = await harness.request(
      "GET",
      `/v1/catalog/products?merchantId=${TEST_MERCHANT_ID}`,
      { auth: PK },
    );
    expect(listed.status).toBe(403);

    const checkout = await harness.request("POST", "/v1/carts/checkout", {
      auth: PK,
      body: {
        merchant,
        currency: "IDR",
        lines: [{ name: "Roti", unitPrice: { amount: "12000.00", asset: "IDR" }, quantity: 1 }],
      },
    });
    expect(checkout.status).toBe(403);
  });

  test("is refused everywhere a secret key is required, with the reason", async () => {
    const harness = createApiHarness();
    mintPk(harness);

    const writes = [
      harness.request("POST", "/v1/catalog/products", { auth: PK, body: productBody() }),
      harness.request("POST", "/v1/payment-intents", {
        auth: PK,
        body: { merchant, amount: { amount: "50000.00", asset: "IDR" } },
      }),
      harness.request("POST", "/v1/payment-links", {
        auth: PK,
        body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
      }),
    ];
    for (const { status, body } of await Promise.all(writes)) {
      expect(status).toBe(403);
      expect(body.error.message).toBe("This route requires a secret key");
    }
  });

  test("a secret key still works on the publishable surface", async () => {
    const harness = createApiHarness();
    const { status } = await harness.request("POST", "/v1/carts/checkout", {
      body: {
        merchant,
        currency: "IDR",
        lines: [{ name: "Roti", unitPrice: { amount: "12000.00", asset: "IDR" }, quantity: 1 }],
      },
    });
    expect(status).toBe(201);
  });
});

describe("CORS on /v1 (#113)", () => {
  test("a browser preflight from any origin is admitted", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/v1/quotes", {
      method: "OPTIONS",
      headers: {
        Origin: "https://toko.example.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "authorization",
    );
  });
});
