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
  test("renders the link page with its amount, and no QR of its own URL", async () => {
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
    // The QR that used to sit here encoded this page's own URL, on a page the
    // buyer already had open. It belongs to the counter, not to the buyer.
    expect(html).not.toContain("<svg");
    // What the page owes the buyer instead: which asset they will send, and
    // that the price is not locked until they act.
    expect(html).toContain("Bayar pakai");
    expect(html).toContain("Harga dikunci");
  });

  test("the link page's button confirms the intent it mints", async () => {
    // Minting alone locks no price and allocates no deposit address, so a page
    // that only mints leaves the payer staring at "menyiapkan alamat" forever.
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });

    const html = await (await harness.app.request(`/checkout/${body.paymentLink.id}`)).text();

    expect(html).toContain(`/payment-links/${body.paymentLink.id}/checkout`);
    expect(html).toContain('"/payment-intents/" + intentId + "/confirm"');
  });

  test("the link page asks for the deposit path, whatever the deployment default is", async () => {
    // The page renders an address and a QR. The contract path needs the payer's
    // own wallet to sign the router call, and there is no wallet to connect
    // here, so a deployment defaulting to it would fail every hosted checkout.
    const harness = createApiHarness();
    const { body } = await harness.request("POST", "/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });

    const html = await (await harness.app.request(`/checkout/${body.paymentLink.id}`)).text();

    expect(html).toContain('executionPath: "deposit-match"');
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

  test("prices a catalog link's lines on the page, without minting anything", async () => {
    // A total with nothing behind it is a number to be taken on trust, and the
    // total itself lives in the products rather than on the link. Minting an
    // intent to find it out would lock a price for a buyer who has not decided.
    const harness = createApiHarness();
    const product = await createCoffee(harness);
    const { body } = await harness.request("POST", "/payment-links", {
      body: {
        kind: "catalog",
        merchant,
        currency: "IDR",
        lines: [{ productId: product.id, quantity: 2 }],
      },
    });

    const before = await harness.intents.list({ merchantId: merchant.id });
    const html = await (await harness.app.request(`/checkout/${body.paymentLink.id}`)).text();
    const after = await harness.intents.list({ merchantId: merchant.id });

    expect(html).toContain("Kopi Susu × 2");
    expect(html).toContain("Rp 50.000,00");
    expect(after.length).toBe(before.length);
  });

  test("the payment page counts down to the price lock's expiry", async () => {
    // A payer who sends the asset a minute after the lock expired has sent
    // funds against a payment that will not accept them, so the deadline is on
    // the screen from the first render rather than discovered at the status.
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

    expect(html).toContain(paid.body.paymentIntent.expiresAt);
    expect(html).toContain("Berlaku sampai");
  });

  test("the payment page replaces the deposit card once the payment is decided", async () => {
    // A finished payment must stop asking to be paid: a QR and an address left
    // on screen invite a second transfer to an address that will not clear it.
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

    expect(html).toContain("Pembayaran selesai");
    expect(html).toContain("Terima kasih sudah membayar");
    // The same replacement on the unhappy paths, for the same reason.
    expect(html).toContain("Masa berlaku habis");
    expect(html).toContain("Pembayaran gagal");
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
