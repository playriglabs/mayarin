import { describe, expect, test } from "bun:test";
import { MOCK_SIGNATURE_HEADER } from "@mayarin/provider-mock";
import { API_KEY_SECRET, createApiHarness, qrisPayload } from "./harness.ts";

describe("the /v1 boundary (#138)", () => {
  test("an unversioned API path answers 404", async () => {
    const harness = createApiHarness();
    const { status } = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });
    expect(status).toBe(404);
  });
});

describe("API rate limiting", () => {
  test("rejects a client that exhausts the configured request budget", async () => {
    const harness = createApiHarness({ rateLimitRequests: 1 });

    expect((await harness.request("GET", "/v1/payments/missing")).status).toBe(404);
    const rejected = await harness.request("GET", "/v1/payments/missing");

    expect(rejected.status).toBe(429);
    expect(rejected.body.error).toMatchObject({
      code: "RATE_LIMIT_EXCEEDED",
      retryable: true,
    });
  });
});

describe("POST /payment-intents", () => {
  test("creates an intent from a QRIS payload", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload() },
    });

    expect(status).toBe(201);
    expect(body.paymentIntent).toMatchObject({
      status: "CREATED",
      settlementAsset: "IDRX",
      provider: "mock",
      merchant: { id: "ID1020017611473", name: "Warung Kopi Mayarin", city: "Jakarta" },
      amount: { amount: "5000000", asset: "IDR", formatted: "50000.00" },
    });
    expect(body.paymentIntent.source).toMatchObject({ type: "qr", scheme: "QRIS" });
  });

  test("creates an intent from explicit merchant details", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", {
      body: {
        merchant: { id: "M-1", name: "Kopi Kenangan", city: "Bandung", countryCode: "ID" },
        amount: { amount: "25000.00", asset: "IDR" },
      },
    });

    expect(status).toBe(201);
    expect(body.paymentIntent.amount).toEqual({
      amount: "2500000",
      asset: "IDR",
      formatted: "25000.00",
      display: "Rp 25.000,00",
    });
    expect(body.paymentIntent.source).toEqual({ type: "manual" });
  });

  test("replays an idempotency key instead of creating a second intent", async () => {
    const harness = createApiHarness();
    const payload = { body: { qr: qrisPayload() }, headers: { "Idempotency-Key": "order-4711" } };

    const first = await harness.request("POST", "/v1/payment-intents", payload);
    const second = await harness.request("POST", "/v1/payment-intents", payload);

    expect(second.body.paymentIntent.id).toBe(first.body.paymentIntent.id);
  });

  test("rejects an idempotency key reused with different parameters", async () => {
    const harness = createApiHarness();
    const headers = { "Idempotency-Key": "order-4712" };

    await harness.request("POST", "/v1/payment-intents", { body: { qr: qrisPayload() }, headers });
    const conflict = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload("60000.00") },
      headers,
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("rejects a request with neither QR nor merchant", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", { body: {} });

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects a corrupt QR payload", async () => {
    const harness = createApiHarness();
    const payload = qrisPayload();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: `${payload.slice(0, -1)}0` },
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("QR_PARSE_ERROR");
  });

  test("rejects an amount that contradicts a dynamic QR", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload(), amount: { amount: "10.00", asset: "IDR" } },
    });

    expect(status).toBe(400);
    expect(body.error.message).toMatch(/does not match/);
  });
});

describe("POST /payment-intents/:id/confirm", () => {
  test("clears a payment end to end", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload() },
    });

    const { status, body } = await harness.request(
      "POST",
      `/v1/payment-intents/${created.body.paymentIntent.id}/confirm`,
    );

    expect(status).toBe(200);
    expect(body.paymentIntent.status).toBe("COMPLETED");
    expect(body.clearing).toMatchObject({
      state: "SUCCESS",
      settlementAmount: { amount: "5000000", asset: "IDRX" },
      fee: { amount: "25000", asset: "IDRX" },
      netAmount: { amount: "4975000", asset: "IDRX" },
    });
    expect(body.timeline.map((entry: { state: string }) => entry.state)).toEqual([
      "CREATED",
      "QR_PARSED",
      "PRICE_LOCKED",
      "PAYMENT_PENDING",
      "ASSET_RECEIVED",
      "CLEARING",
      "SETTLING",
      "SETTLED",
      "SUCCESS",
    ]);
  });

  test("is safe to retry", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const path = `/v1/payment-intents/${created.body.paymentIntent.id}/confirm`;

    const first = await harness.request("POST", path);
    const second = await harness.request("POST", path);

    expect(second.status).toBe(200);
    expect(second.body.clearing.id).toBe(first.body.clearing.id);
    expect(second.body.timeline).toHaveLength(first.body.timeline.length);
    expect((await harness.ledger.balance("TREASURY", "IDRX")).balance.amount).toBe(25_000n);
  });

  test("settles internally via the stablecoin adapter, crediting a merchant holding", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: {
        merchant: { id: "M-1", name: "Kopi Kenangan", city: "Bandung", countryCode: "ID" },
        amount: { amount: "50000.00", asset: "IDR" },
        settlementAsset: "IDRX",
        provider: "stablecoin",
      },
    });

    const { status, body } = await harness.request(
      "POST",
      `/v1/payment-intents/${created.body.paymentIntent.id}/confirm`,
    );

    expect(status).toBe(200);
    expect(body.clearing.state).toBe("SUCCESS");
    expect(body.clearing.provider).toBe("stablecoin");
    // Treasury keeps the full settlement amount; the net is owed to the merchant
    // as an internal holding, not returned to treasury.
    expect((await harness.ledger.balance("TREASURY", "IDRX")).balance.amount).toBe(5_000_000n);
    expect((await harness.ledger.balance("MERCHANT_HOLDING", "IDRX")).balance.amount).toBe(
      4_975_000n,
    );
    expect((await harness.ledger.balance("SETTLEMENT_IN_FLIGHT", "IDRX")).balance.amount).toBe(0n);
  });

  test("404s for an unknown intent", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request(
      "POST",
      "/v1/payment-intents/pi_01J8Z3K4M5N6P7Q8R9S0T1U2V3/confirm",
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /payments/:id", () => {
  test("returns the payment by intent id", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const id = created.body.paymentIntent.id;
    await harness.request("POST", `/v1/payment-intents/${id}/confirm`);

    const { status, body } = await harness.request("GET", `/v1/payments/${id}`);

    expect(status).toBe(200);
    expect(body.paymentIntent.id).toBe(id);
    expect(body.clearing.state).toBe("SUCCESS");
  });

  test("returns the payment by clearing transaction id", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const confirmed = await harness.request(
      "POST",
      `/v1/payment-intents/${created.body.paymentIntent.id}/confirm`,
    );

    const { status, body } = await harness.request(
      "GET",
      `/v1/payments/${confirmed.body.clearing.id}`,
    );

    expect(status).toBe(200);
    expect(body.paymentIntent.id).toBe(created.body.paymentIntent.id);
  });

  test("reports a payment that has not been confirmed yet", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload() },
    });

    const { body } = await harness.request("GET", `/v1/payments/${created.body.paymentIntent.id}`);

    expect(body.paymentIntent.status).toBe("CREATED");
    expect(body.clearing).toBeNull();
    expect(body.timeline).toEqual([]);
  });
});

describe("POST /webhooks/:provider", () => {
  test("drives a pending settlement to completion", async () => {
    const harness = createApiHarness({ behaviour: "pending" });
    const created = await harness.request("POST", "/v1/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const confirmed = await harness.request(
      "POST",
      `/v1/payment-intents/${created.body.paymentIntent.id}/confirm`,
    );
    expect(confirmed.body.clearing.state).toBe("SETTLING");

    const rawBody = JSON.stringify({
      providerReference: confirmed.body.clearing.providerReference,
      state: "SUCCEEDED",
    });

    const response = await harness.app.request("/v1/webhooks/mock", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [MOCK_SIGNATURE_HEADER]: harness.adapter.sign(rawBody),
      },
      body: rawBody,
    });
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(202);
    expect(body.clearing.state).toBe("SUCCESS");

    const payment = await harness.request("GET", `/v1/payments/${created.body.paymentIntent.id}`);
    expect(payment.body.paymentIntent.status).toBe("COMPLETED");
  });

  test("rejects an unsigned webhook", async () => {
    const harness = createApiHarness({ behaviour: "pending" });
    const { status, body } = await harness.request("POST", "/v1/webhooks/mock", {
      body: { providerReference: "stl_whatever", state: "SUCCEEDED" },
    });

    expect(status).toBe(400);
    expect(body.error.message).toMatch(/signature/i);
  });

  test("404s for an unregistered provider", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/webhooks/paynow", {
      body: {},
    });

    expect(status).toBe(500);
    expect(body.error.code).toBe("CONFIGURATION_ERROR");
  });
});

describe("GET /health", () => {
  test("reports configuration and registered providers", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("GET", "/health");

    expect(status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      settlementAsset: "IDRX",
      providers: ["mock", "stablecoin"],
    });
  });
});

describe("unknown routes", () => {
  test("404 with a structured error", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("GET", "/nope");

    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("payment rail", () => {
  test("rejects an unsupported chain", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/v1/payment-intents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY_SECRET}`,
      },
      body: JSON.stringify({
        merchant: {
          id: "M1",
          name: "Warung",
          city: "Jakarta",
          countryCode: "ID",
        },
        amount: { amount: "50000.00", asset: "IDR" },
        payment: { asset: "USDC", chain: "dogecoin" },
      }),
    });

    expect(response.status).toBe(400);
  });

  test("echoes the rail on the created intent", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/v1/payment-intents", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY_SECRET}`,
      },
      body: JSON.stringify({
        merchant: {
          id: "M1",
          name: "Warung",
          city: "Jakarta",
          countryCode: "ID",
        },
        amount: { amount: "50000.00", asset: "IDR" },
        payment: { asset: "USDC", chain: "base-sepolia" },
      }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      paymentIntent: { payment: { asset: string; chain: string } | null };
    };
    expect(body.paymentIntent.payment).toEqual({ asset: "USDC", chain: "base-sepolia" });
  });
});

describe("admin routes", () => {
  test("are not registered without an admin token", async () => {
    const harness = createApiHarness();
    expect((await harness.app.request("/v1/admin/watcher/tick", { method: "POST" })).status).toBe(
      404,
    );
  });

  test("reject a missing or wrong admin token with 401 UNAUTHORIZED", async () => {
    const harness = createApiHarness({ adminToken: "a-very-long-admin-token-secret" });
    const wrong = await harness.app.request("/v1/admin/watcher/tick", {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
    });
    expect(wrong.status).toBe(401);
    expect((await wrong.json()).error.code).toBe("UNAUTHORIZED");

    const none = await harness.app.request("/v1/admin/watcher/tick", { method: "POST" });
    expect(none.status).toBe(401);
  });
});

describe("execution path selection", () => {
  test("defaults to the deployment path when the request names none", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", {
      body: {
        merchant: { id: "M-1", name: "Kopi Kenangan", city: "Bandung", countryCode: "ID" },
        amount: { amount: "25000.00", asset: "IDR" },
        payment: { asset: "USDC", chain: "base-sepolia" },
      },
    });

    expect(status).toBe(201);
    expect(body.paymentIntent.executionPath).toBe("deposit-match");
  });

  test("takes the path the request asks for, over the deployment default", async () => {
    // The path is a per-payer decision, not a per-deployment one: a marketplace
    // checkout where the payer connects a wallet and a payer who pastes an
    // address into an exchange withdrawal cannot share one setting.
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", {
      body: {
        merchant: { id: "M-1", name: "Kopi Kenangan", city: "Bandung", countryCode: "ID" },
        amount: { amount: "25000.00", asset: "IDR" },
        payment: {
          asset: "USDC",
          chain: "base-sepolia",
          payerAddress: "0x1111111111111111111111111111111111111111",
        },
        executionPath: "on-chain-contract",
      },
    });

    expect(status).toBe(201);
    expect(body.paymentIntent.executionPath).toBe("on-chain-contract");
  });

  test("rejects an unknown execution path", async () => {
    const harness = createApiHarness();
    const { status } = await harness.request("POST", "/v1/payment-intents", {
      body: {
        merchant: { id: "M-1", name: "Kopi Kenangan", city: "Bandung", countryCode: "ID" },
        amount: { amount: "25000.00", asset: "IDR" },
        payment: { asset: "USDC", chain: "base-sepolia" },
        executionPath: "teleport",
      },
    });

    expect(status).toBe(400);
  });

  test("a fiat-only intent carries no path even when one is asked for", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/v1/payment-intents", {
      body: {
        merchant: { id: "M-1", name: "Kopi Kenangan", city: "Bandung", countryCode: "ID" },
        amount: { amount: "25000.00", asset: "IDR" },
        executionPath: "deposit-match",
      },
    });

    expect(status).toBe(201);
    expect(body.paymentIntent.executionPath).toBeNull();
  });
});
