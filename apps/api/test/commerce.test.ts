import { describe, expect, test } from "bun:test";
import { createApiHarness, qrisPayload } from "./harness.ts";

const merchant = { id: "mrc_1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };

async function createCoffee(harness: ReturnType<typeof createApiHarness>) {
  const { body } = await harness.request("POST", "/catalog/products", {
    body: {
      merchantId: merchant.id,
      sku: "KOPI-01",
      name: "Kopi Susu",
      prices: [
        { amount: "25000.00", asset: "IDR" },
        { amount: "7.50", asset: "MYR" },
      ],
    },
  });
  return body.product;
}

describe("the catalog is optional", () => {
  test("a payment is taken end to end without a single product row", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });
    expect(created.status).toBe(201);

    const confirmed = await harness.request(
      "POST",
      `/payment-intents/${created.body.paymentIntent.id}/confirm`,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.paymentIntent.status).toBe("COMPLETED");
  });
});

describe("POST /catalog/products", () => {
  test("prices one product in several currencies", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/catalog/products", {
      body: {
        merchantId: merchant.id,
        sku: "KOPI-01",
        name: "Kopi Susu",
        prices: [
          { amount: "25000.00", asset: "IDR" },
          { amount: "7.50", asset: "MYR" },
        ],
      },
    });

    expect(status).toBe(201);
    expect(body.product.prices).toEqual([
      { amount: "2500000", asset: "IDR", formatted: "25000.00", display: "Rp 25.000,00" },
      { amount: "750", asset: "MYR", formatted: "7.50", display: "RM 7,50" },
    ]);
  });

  test("refuses a duplicate SKU for the same merchant", async () => {
    const harness = createApiHarness();
    await createCoffee(harness);
    const { status } = await harness.request("POST", "/catalog/products", {
      body: {
        merchantId: merchant.id,
        sku: "KOPI-01",
        name: "Kopi Susu",
        prices: [{ amount: "25000.00", asset: "IDR" }],
      },
    });
    expect(status).toBe(409);
  });

  test("lists a merchant's products", async () => {
    const harness = createApiHarness();
    await createCoffee(harness);
    const { body } = await harness.request("GET", `/catalog/products?merchantId=${merchant.id}`);
    expect(body.products).toHaveLength(1);
  });
});

describe("POST /carts/checkout", () => {
  test("folds a cart into one payment intent", async () => {
    const harness = createApiHarness();
    const product = await createCoffee(harness);

    const { status, body } = await harness.request("POST", "/carts/checkout", {
      body: {
        merchant,
        currency: "IDR",
        lines: [
          { productId: product.id, quantity: 2 },
          { name: "Roti", unitPrice: { amount: "12000.00", asset: "IDR" }, quantity: 1 },
        ],
        merchantReference: "INV-1042",
      },
    });

    expect(status).toBe(201);
    expect(body.paymentIntent.amount).toMatchObject({ amount: "6200000", asset: "IDR" });
    expect(body.paymentIntent.merchantReference).toBe("INV-1042");
    expect(JSON.parse(body.paymentIntent.metadata.cart).lines).toHaveLength(2);
  });

  test("an idempotency key makes a retried checkout return the same intent", async () => {
    const harness = createApiHarness();
    const body = {
      merchant,
      currency: "IDR",
      lines: [{ name: "Roti", unitPrice: { amount: "12000.00", asset: "IDR" }, quantity: 1 }],
    };
    const headers = { "Idempotency-Key": "cart-key-00001" };

    const first = await harness.request("POST", "/carts/checkout", { body, headers });
    const second = await harness.request("POST", "/carts/checkout", { body, headers });

    expect(second.body.paymentIntent.id).toBe(first.body.paymentIntent.id);
  });

  test("refuses a currency the product is not priced in", async () => {
    const harness = createApiHarness();
    const product = await createCoffee(harness);

    const { status } = await harness.request("POST", "/carts/checkout", {
      body: { merchant, currency: "THB", lines: [{ productId: product.id, quantity: 1 }] },
    });
    expect(status).toBe(400);
  });
});

describe("payment links", () => {
  test("a fixed link is payable and carries a shareable URL", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });

    expect(created.status).toBe(201);
    expect(created.body.paymentLink.payable).toBe(true);
    expect(created.body.paymentLink.url).toBe(
      `http://localhost:3000/checkout/${created.body.paymentLink.id}`,
    );

    const paid = await harness.request(
      "POST",
      `/payment-links/${created.body.paymentLink.id}/checkout`,
      { body: {} },
    );
    expect(paid.status).toBe(201);
    expect(paid.body.paymentIntent.amount).toMatchObject({ amount: "5000000", asset: "IDR" });
  });

  test("an open link takes the amount the buyer enters, twice over", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/payment-links", {
      body: { kind: "open", merchant, currency: "IDR", title: "Kasir 1" },
    });

    const first = await harness.request("POST", `/payment-links/${body.paymentLink.id}/checkout`, {
      body: { amount: { amount: "10000.00", asset: "IDR" } },
    });
    const second = await harness.request("POST", `/payment-links/${body.paymentLink.id}/checkout`, {
      body: { amount: { amount: "20000.00", asset: "IDR" } },
    });

    expect(first.body.paymentIntent.id).not.toBe(second.body.paymentIntent.id);
    expect(second.body.paymentIntent.amount).toMatchObject({ amount: "2000000" });
  });

  test("a catalog link prices from the products at checkout", async () => {
    const harness = createApiHarness();
    const product = await createCoffee(harness);

    const { body } = await harness.request("POST", "/payment-links", {
      body: {
        kind: "catalog",
        merchant,
        currency: "IDR",
        lines: [{ productId: product.id, quantity: 3 }],
      },
    });

    const paid = await harness.request("POST", `/payment-links/${body.paymentLink.id}/checkout`, {
      body: {},
    });
    expect(paid.body.paymentIntent.amount).toMatchObject({ amount: "7500000" });
  });

  test("a disabled link cannot be paid", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/payment-links", {
      body: { kind: "open", merchant, currency: "IDR" },
    });
    await harness.request("POST", `/payment-links/${body.paymentLink.id}/disable`);

    const paid = await harness.request("POST", `/payment-links/${body.paymentLink.id}/checkout`, {
      body: { amount: { amount: "10000.00", asset: "IDR" } },
    });
    expect(paid.status).toBe(409);
  });

  test("an expired link cannot be paid", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/payment-links", {
      body: {
        kind: "open",
        merchant,
        currency: "IDR",
        expiresAt: "2026-01-01T00:10:00.000Z",
      },
    });

    harness.clock.set("2026-01-01T00:10:00.000Z");
    const paid = await harness.request("POST", `/payment-links/${body.paymentLink.id}/checkout`, {
      body: { amount: { amount: "10000.00", asset: "IDR" } },
    });
    expect(paid.status).toBe(409);
  });

  test("an idempotency key makes a retried link creation return the same link", async () => {
    const harness = createApiHarness();
    const body = { kind: "open", merchant, currency: "IDR" };
    const headers = { "Idempotency-Key": "link-key-00001" };

    const first = await harness.request("POST", "/payment-links", { body, headers });
    const second = await harness.request("POST", "/payment-links", { body, headers });

    expect(second.body.paymentLink.id).toBe(first.body.paymentLink.id);
  });
});

describe("hosted checkout", () => {
  test("renders the link page with its amount and a QR", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/payment-links", {
      body: {
        kind: "fixed",
        merchant,
        amount: { amount: "50000.00", asset: "IDR" },
        title: "Paket",
      },
    });

    const response = await harness.app.request(`/checkout/${body.paymentLink.id}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Rp 50.000,00");
    expect(html).toContain("Paket");
    expect(html).toContain("<svg");
  });

  test("escapes a merchant name rather than rendering it as markup", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/payment-links", {
      body: {
        kind: "open",
        merchant: { ...merchant, name: "<script>alert(1)</script>" },
        currency: "IDR",
      },
    });

    const response = await harness.app.request(`/checkout/${body.paymentLink.id}`);
    const html = await response.text();

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("renders the payment page for a minted intent", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    const paid = await harness.request("POST", `/payment-links/${body.paymentLink.id}/checkout`, {
      body: {},
    });

    const response = await harness.app.request(`/checkout/pay/${paid.body.paymentIntent.id}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(paid.body.paymentIntent.id);
    expect(html).toContain("Rp 50.000,00");
  });

  test("serves a QR for an arbitrary value", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/checkout/qr?value=ethereum%3A0xabc");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  test("refuses a QR value long enough to be a payload", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request(`/checkout/qr?value=${"a".repeat(513)}`);
    expect(response.status).toBe(400);
  });
});

describe("merchant reference", () => {
  test("round-trips through creation and retrieval", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/payment-intents", {
      body: {
        merchant,
        amount: { amount: "25000.00", asset: "IDR" },
        merchantReference: "ORDER-7",
      },
    });

    const fetched = await harness.request(
      "GET",
      `/payment-intents/${created.body.paymentIntent.id}`,
    );
    expect(fetched.body.paymentIntent.merchantReference).toBe("ORDER-7");
  });

  test("is looked up behind the admin token, never on the public surface", async () => {
    const harness = createApiHarness({ adminToken: "admin-token-1234567890" });
    await harness.request("POST", "/payment-intents", {
      body: {
        merchant,
        amount: { amount: "25000.00", asset: "IDR" },
        merchantReference: "ORDER-8",
      },
    });

    const unauthorised = await harness.request(
      "GET",
      `/admin/payment-intents?merchantId=${merchant.id}&merchantReference=ORDER-8`,
    );
    expect(unauthorised.status).toBe(401);

    const authorised = await harness.request(
      "GET",
      `/admin/payment-intents?merchantId=${merchant.id}&merchantReference=ORDER-8`,
      { headers: { Authorization: "Bearer admin-token-1234567890" } },
    );
    expect(authorised.status).toBe(200);
    expect(authorised.body.paymentIntents).toHaveLength(1);
  });
});

describe("live payment status", () => {
  test("the stream opens with the current status and stays open", async () => {
    const harness = createApiHarness();
    await harness.stream.start();

    const created = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const id = created.body.paymentIntent.id;

    const response = await harness.app.request(`/checkout/events/${id}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    // The first frame carries the status the page already has, so a payer who
    // connects after a change does not wait for the next one to learn it.
    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    const frame = new TextDecoder().decode(chunk?.value);

    expect(frame).toContain("event: payment");
    expect(frame).toContain("CREATED");

    await reader?.cancel();
  });

  test("an unknown payment is a 404 rather than a silent open stream", async () => {
    const harness = createApiHarness();
    await harness.stream.start();

    const response = await harness.app.request("/checkout/events/pi_does_not_exist");
    expect(response.status).toBe(404);
  });

  test("the page asks for the stream and keeps polling as a fallback", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    const paid = await harness.request("POST", `/payment-links/${body.paymentLink.id}/checkout`, {
      body: {},
    });

    const html = await (
      await harness.app.request(`/checkout/pay/${paid.body.paymentIntent.id}`)
    ).text();

    expect(html).toContain("EventSource");
    // The poll is the path a payer behind a buffering proxy actually takes.
    expect(html).toContain("startPolling");
  });
});
