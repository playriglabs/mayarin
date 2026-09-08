import { describe, expect, test } from "bun:test";
import { checkoutSuccessUrl } from "../src/routes/checkout-page.ts";
import { createApiHarness, qrisPayload } from "./harness.ts";

const merchant = { id: "mrc_1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };

async function createCoffee(harness: ReturnType<typeof createApiHarness>) {
  const { body } = await harness.request("POST", "/v1/catalog/products", {
    body: {
      merchantId: merchant.id,
      sku: "KOPI-01",
      name: "Kopi Susu",
      description: "Kopi susu gula aren",
      metadata: { image: "https://cdn.example.com/kopi-susu.webp" },
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
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload() },
    });
    expect(created.status).toBe(201);

    const confirmed = await harness.request(
      "POST",
      `/v1/payment-intents/${created.body.paymentIntent.id}/confirm`,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.paymentIntent.status).toBe("COMPLETED");
  });
});

describe("POST /catalog/products", () => {
  test("prices one product in several currencies", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/catalog/products", {
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
    const { status } = await harness.request("POST", "/v1/catalog/products", {
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
    const { body } = await harness.request("GET", `/v1/catalog/products?merchantId=${merchant.id}`);
    expect(body.products).toHaveLength(1);
  });

  test("does not list an inactive product by default", async () => {
    const harness = createApiHarness();
    const product = await createCoffee(harness);
    const archived = await harness.request("PATCH", `/v1/catalog/products/${product.id}`, {
      body: { active: false },
    });
    expect(archived.status).toBe(200);

    const { body } = await harness.request("GET", `/v1/catalog/products?merchantId=${merchant.id}`);
    expect(body.products).toEqual([]);
  });
});

describe("POST /carts/checkout", () => {
  test("folds a cart into one payment intent", async () => {
    const harness = createApiHarness();
    const product = await createCoffee(harness);

    const { status, body } = await harness.request("POST", "/v1/carts/checkout", {
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

    const first = await harness.request("POST", "/v1/carts/checkout", { body, headers });
    const second = await harness.request("POST", "/v1/carts/checkout", { body, headers });

    expect(second.body.paymentIntent.id).toBe(first.body.paymentIntent.id);
  });

  test("refuses a currency the product is not priced in", async () => {
    const harness = createApiHarness();
    const product = await createCoffee(harness);

    const { status } = await harness.request("POST", "/v1/carts/checkout", {
      body: { merchant, currency: "THB", lines: [{ productId: product.id, quantity: 1 }] },
    });
    expect(status).toBe(400);
  });
});

describe("payment links", () => {
  test("a fixed link is payable and carries a shareable URL", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });

    expect(created.status).toBe(201);
    expect(created.body.paymentLink.payable).toBe(true);
    expect(created.body.paymentLink.url).toBe(
      `http://localhost:3000/checkout/${created.body.paymentLink.id}`,
    );

    const paid = await harness.request(
      "POST",
      `/v1/payment-links/${created.body.paymentLink.id}/checkout`,
      { body: {} },
    );
    expect(paid.status).toBe(201);
    expect(paid.body.paymentIntent.amount).toMatchObject({ amount: "5000000", asset: "IDR" });
  });

  test("can opt into discovery at creation and withdraw or restore that listing", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-links", {
      body: {
        kind: "fixed",
        merchant,
        amount: { amount: "50000.00", asset: "IDR" },
        listed: true,
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.paymentLink.listed).toBe(true);

    const id = created.body.paymentLink.id as string;
    const unlisted = await harness.request("POST", `/v1/payment-links/${id}/unlist`);
    const relisted = await harness.request("POST", `/v1/payment-links/${id}/list`);

    expect(unlisted.status).toBe(200);
    expect(unlisted.body.paymentLink.listed).toBe(false);
    expect(relisted.status).toBe(200);
    expect(relisted.body.paymentLink.listed).toBe(true);
  });

  test("an open link takes the amount the buyer enters, twice over", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "open", merchant, currency: "IDR", title: "Kasir 1" },
    });

    const first = await harness.request(
      "POST",
      `/v1/payment-links/${body.paymentLink.id}/checkout`,
      {
        body: { amount: { amount: "10000.00", asset: "IDR" } },
      },
    );
    const second = await harness.request(
      "POST",
      `/v1/payment-links/${body.paymentLink.id}/checkout`,
      {
        body: { amount: { amount: "20000.00", asset: "IDR" } },
      },
    );

    expect(first.body.paymentIntent.id).not.toBe(second.body.paymentIntent.id);
    expect(second.body.paymentIntent.amount).toMatchObject({ amount: "2000000" });
  });

  test("a catalog link prices from the products at checkout", async () => {
    const harness = createApiHarness();
    const product = await createCoffee(harness);

    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: {
        kind: "catalog",
        merchant,
        currency: "IDR",
        lines: [{ productId: product.id, quantity: 3 }],
      },
    });

    const paid = await harness.request(
      "POST",
      `/v1/payment-links/${body.paymentLink.id}/checkout`,
      {
        body: {},
      },
    );
    expect(paid.body.paymentIntent.amount).toMatchObject({ amount: "7500000" });
  });

  test("a disabled link cannot be paid", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "open", merchant, currency: "IDR" },
    });
    await harness.request("POST", `/v1/payment-links/${body.paymentLink.id}/disable`);

    const paid = await harness.request(
      "POST",
      `/v1/payment-links/${body.paymentLink.id}/checkout`,
      {
        body: { amount: { amount: "10000.00", asset: "IDR" } },
      },
    );
    expect(paid.status).toBe(409);
  });

  test("an expired link cannot be paid", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: {
        kind: "open",
        merchant,
        currency: "IDR",
        expiresAt: "2026-01-01T00:10:00.000Z",
      },
    });

    harness.clock.set("2026-01-01T00:10:00.000Z");
    const paid = await harness.request(
      "POST",
      `/v1/payment-links/${body.paymentLink.id}/checkout`,
      {
        body: { amount: { amount: "10000.00", asset: "IDR" } },
      },
    );
    expect(paid.status).toBe(409);
  });

  test("an idempotency key makes a retried link creation return the same link", async () => {
    const harness = createApiHarness();
    const body = { kind: "open", merchant, currency: "IDR" };
    const headers = { "Idempotency-Key": "link-key-00001" };

    const first = await harness.request("POST", "/v1/payment-links", { body, headers });
    const second = await harness.request("POST", "/v1/payment-links", { body, headers });

    expect(second.body.paymentLink.id).toBe(first.body.paymentLink.id);
  });
});

describe("hosted checkout", () => {
  test("builds only HTTPS or localhost merchant success URLs", () => {
    expect(checkoutSuccessUrl("https://shop.example/checkout/success", "pi_1")).toBe(
      "https://shop.example/checkout/success/pi_1",
    );
    expect(checkoutSuccessUrl("http://localhost:5173/checkout/success", "pi_1")).toBe(
      "http://localhost:5173/checkout/success/pi_1",
    );
    expect(checkoutSuccessUrl("http://shop.example/checkout/success", "pi_1")).toBeUndefined();
  });

  test("boots the link page with its amount, and everything the SPA needs to mint", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: {
        kind: "fixed",
        merchant,
        amount: { amount: "50000.00", asset: "IDR" },
        title: "Paket",
      },
    });

    const page = await harness.requestBootstrap(`/checkout/${body.paymentLink.id}`);

    expect(page.status).toBe(200);
    expect(page.bootstrap.page).toBe("link");
    expect(page.bootstrap.title).toBe("Paket");
    expect(page.bootstrap.total.display).toBe("Rp 50.000,00");
    // The SPA mints against this id and offers these rails — the whole checkout
    // flow hangs off the bootstrap, not a second fetch. One entry per
    // `(chain, asset)` pair, so the page never has to guess a chain (#244).
    expect(page.bootstrap.linkId).toBe(body.paymentLink.id);
    expect(page.bootstrap.payable).toBe(true);
    expect(page.bootstrap.rails).toEqual([
      {
        chain: "base-sepolia",
        asset: "USDC",
        contract: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      },
    ]);
    // The lock note's figure: the price is not locked until the buyer acts.
    expect(page.bootstrap.lockMinutes).toBe(15);
  });

  test("injects the bootstrap as data, not as markup a merchant can escape", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: {
        kind: "open",
        merchant: { ...merchant, name: "</script><script>alert(1)</script>" },
        currency: "IDR",
      },
    });

    const page = await harness.requestBootstrap(`/checkout/${body.paymentLink.id}`);

    // The raw sequence would close the bootstrap script element and open an
    // attacker-controlled one. Escaped, it is a JSON string like any other.
    expect(page.text).not.toContain("<script>alert(1)</script>");
    expect(page.bootstrap.merchant.name).toBe("</script><script>alert(1)</script>");
  });

  test("renders the payment page for a minted intent", async () => {
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    const paid = await harness.request(
      "POST",
      `/v1/payment-links/${body.paymentLink.id}/checkout`,
      {
        body: {},
      },
    );

    const page = await harness.requestBootstrap(`/checkout/pay/${paid.body.paymentIntent.id}`);

    expect(page.status).toBe(200);
    expect(page.bootstrap.page).toBe("pay");
    expect(page.bootstrap.intentId).toBe(paid.body.paymentIntent.id);
    expect(page.bootstrap.amount.display).toBe("Rp 50.000,00");
    // Where the SPA reads status from, and how, are the page's to know.
    expect(page.bootstrap.statusUrl).toBe(
      `http://localhost:3000/v1/payments/${paid.body.paymentIntent.id}`,
    );
    expect(typeof page.bootstrap.streaming).toBe("boolean");
    expect(page.bootstrap.pollMs).toBeGreaterThan(0);
  });

  test("prices a catalog link's lines on the page, without minting anything", async () => {
    // A total with nothing behind it is a number to be taken on trust, and the
    // total itself lives in the products rather than on the link. Minting an
    // intent to find it out would lock a price for a buyer who has not decided.
    const harness = createApiHarness();
    const product = await createCoffee(harness);
    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: {
        kind: "catalog",
        merchant,
        currency: "IDR",
        lines: [{ productId: product.id, quantity: 2 }],
      },
    });

    const before = await harness.intents.list({ merchantId: merchant.id });
    const page = await harness.requestBootstrap(`/checkout/${body.paymentLink.id}`);
    const after = await harness.intents.list({ merchantId: merchant.id });

    expect(page.bootstrap.lines).toEqual([
      expect.objectContaining({
        name: "Kopi Susu",
        description: "Kopi susu gula aren",
        imageUrl: "https://cdn.example.com/kopi-susu.webp",
        quantity: 2,
        lineTotal: expect.objectContaining({ display: "Rp 50.000,00" }),
      }),
    ]);
    expect(page.bootstrap.total.display).toBe("Rp 50.000,00");
    expect(after.length).toBe(before.length);
  });

  test("the payment page counts down to the price lock's expiry", async () => {
    // A payer who sends the asset a minute after the lock expired has sent
    // funds against a payment that will not accept them, so the deadline is on
    // the screen from the first render rather than discovered at the status.
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    const paid = await harness.request(
      "POST",
      `/v1/payment-links/${body.paymentLink.id}/checkout`,
      {
        body: {},
      },
    );

    const page = await harness.requestBootstrap(`/checkout/pay/${paid.body.paymentIntent.id}`);

    expect(page.bootstrap.expiresAt).toBe(paid.body.paymentIntent.expiresAt);
  });

  test("serves a QR for an arbitrary value", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/checkout/qr?value=ethereum%3A0xabc");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
    expect(await response.text()).toContain("<svg");
  });

  test("serves a self-contained branded payment-link QR as a PNG download", async () => {
    const harness = createApiHarness();
    const svgResponse = await harness.app.request(
      "/checkout/qr?value=https%3A%2F%2Fmayarin.xyz%2Fcheckout%2Flnk_test&brand=mayarin",
    );
    const downloadResponse = await harness.app.request(
      "/checkout/qr?value=https%3A%2F%2Fmayarin.xyz%2Fcheckout%2Flnk_test&brand=mayarin&format=png&download=true",
    );
    const svg = await svgResponse.text();
    const png = new Uint8Array(await downloadResponse.arrayBuffer());

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toContain("image/png");
    expect(downloadResponse.headers.get("content-disposition")).toBe(
      'attachment; filename="mayarin-payment-qr.png"',
    );
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(svg).toContain(
      "Mayarin brand mark source: https://mayarin.xyz/brand-kit/mayarin-white.png",
    );
    expect(svg).toMatch(/<image x="\d+" y="\d+" width="\d+" height="\d+"/);
    expect(svg).toContain('href="data:image/png;base64,');
    expect(svg).toContain('rx="0.4" fill="none" stroke="#d4d4d4"');
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
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: {
        merchant,
        amount: { amount: "25000.00", asset: "IDR" },
        merchantReference: "ORDER-7",
      },
    });

    const fetched = await harness.request(
      "GET",
      `/v1/payment-intents/${created.body.paymentIntent.id}`,
    );
    expect(fetched.body.paymentIntent.merchantReference).toBe("ORDER-7");
  });

  test("is looked up behind the admin token, never on the public surface", async () => {
    const harness = createApiHarness({ adminToken: "admin-token-1234567890" });
    await harness.request("POST", "/v1/payment-intents", {
      body: {
        merchant,
        amount: { amount: "25000.00", asset: "IDR" },
        merchantReference: "ORDER-8",
      },
    });

    // The admin surface has its own bearer token, so the merchant API key the
    // harness sends by default must not stand in for it.
    const unauthorised = await harness.request(
      "GET",
      `/v1/admin/payment-intents?merchantId=${merchant.id}&merchantReference=ORDER-8`,
      { auth: false },
    );
    expect(unauthorised.status).toBe(401);

    const authorised = await harness.request(
      "GET",
      `/v1/admin/payment-intents?merchantId=${merchant.id}&merchantReference=ORDER-8`,
      { auth: false, headers: { Authorization: "Bearer admin-token-1234567890" } },
    );
    expect(authorised.status).toBe(200);
    expect(authorised.body.paymentIntents).toHaveLength(1);
  });
});

describe("live payment status", () => {
  test("the stream opens with the current status and stays open", async () => {
    const harness = createApiHarness();
    await harness.stream.start();

    const created = await harness.request("POST", "/v1/payment-intents", {
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

  test("the page is told the stream exists, and how fast to poll without it", async () => {
    // Whether to open an EventSource is the SPA's call, but only the server
    // knows if this deployment runs one. The poll interval rides along because
    // the fallback is the path a payer behind a buffering proxy actually takes.
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    const paid = await harness.request(
      "POST",
      `/v1/payment-links/${body.paymentLink.id}/checkout`,
      {
        body: {},
      },
    );

    const page = await harness.requestBootstrap(`/checkout/pay/${paid.body.paymentIntent.id}`);

    expect(page.bootstrap.streaming).toBe(true);
    expect(page.bootstrap.pollMs).toBe(8000);
  });
});
