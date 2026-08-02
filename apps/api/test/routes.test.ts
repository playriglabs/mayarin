import { describe, expect, test } from "bun:test";
import { MOCK_SIGNATURE_HEADER } from "@mayarr/provider-mock";
import { createApiHarness, qrisPayload } from "./harness.ts";

describe("POST /payment-intents", () => {
  test("creates an intent from a QRIS payload", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });

    expect(status).toBe(201);
    expect(body.paymentIntent).toMatchObject({
      status: "CREATED",
      settlementAsset: "IDRX",
      provider: "mock",
      merchant: { id: "ID1020017611473", name: "Warung Kopi Mayarr", city: "Jakarta" },
      amount: { amount: "5000000", asset: "IDR", formatted: "50000.00" },
    });
    expect(body.paymentIntent.source).toMatchObject({ type: "qr", scheme: "QRIS" });
  });

  test("creates an intent from explicit merchant details", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/payment-intents", {
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
    });
    expect(body.paymentIntent.source).toEqual({ type: "manual" });
  });

  test("replays an idempotency key instead of creating a second intent", async () => {
    const harness = createApiHarness();
    const payload = { body: { qr: qrisPayload() }, headers: { "Idempotency-Key": "order-4711" } };

    const first = await harness.request("POST", "/payment-intents", payload);
    const second = await harness.request("POST", "/payment-intents", payload);

    expect(second.body.paymentIntent.id).toBe(first.body.paymentIntent.id);
  });

  test("rejects an idempotency key reused with different parameters", async () => {
    const harness = createApiHarness();
    const headers = { "Idempotency-Key": "order-4712" };

    await harness.request("POST", "/payment-intents", { body: { qr: qrisPayload() }, headers });
    const conflict = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload("60000.00") },
      headers,
    });

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("rejects a request with neither QR nor merchant", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/payment-intents", { body: {} });

    expect(status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("rejects a corrupt QR payload", async () => {
    const harness = createApiHarness();
    const payload = qrisPayload();
    const { status, body } = await harness.request("POST", "/payment-intents", {
      body: { qr: `${payload.slice(0, -1)}0` },
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe("QR_PARSE_ERROR");
  });

  test("rejects an amount that contradicts a dynamic QR", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload(), amount: { amount: "10.00", asset: "IDR" } },
    });

    expect(status).toBe(400);
    expect(body.error.message).toMatch(/does not match/);
  });
});

describe("POST /payment-intents/:id/confirm", () => {
  test("clears a payment end to end", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });

    const { status, body } = await harness.request(
      "POST",
      `/payment-intents/${created.body.paymentIntent.id}/confirm`,
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
    const created = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const path = `/payment-intents/${created.body.paymentIntent.id}/confirm`;

    const first = await harness.request("POST", path);
    const second = await harness.request("POST", path);

    expect(second.status).toBe(200);
    expect(second.body.clearing.id).toBe(first.body.clearing.id);
    expect(second.body.timeline).toHaveLength(first.body.timeline.length);
    expect((await harness.ledger.balance("TREASURY", "IDRX")).balance.amount).toBe(25_000n);
  });

  test("404s for an unknown intent", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request(
      "POST",
      "/payment-intents/pi_01J8Z3K4M5N6P7Q8R9S0T1U2V3/confirm",
    );

    expect(status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("GET /payments/:id", () => {
  test("returns the payment by intent id", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const id = created.body.paymentIntent.id;
    await harness.request("POST", `/payment-intents/${id}/confirm`);

    const { status, body } = await harness.request("GET", `/payments/${id}`);

    expect(status).toBe(200);
    expect(body.paymentIntent.id).toBe(id);
    expect(body.clearing.state).toBe("SUCCESS");
  });

  test("returns the payment by clearing transaction id", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const confirmed = await harness.request(
      "POST",
      `/payment-intents/${created.body.paymentIntent.id}/confirm`,
    );

    const { status, body } = await harness.request(
      "GET",
      `/payments/${confirmed.body.clearing.id}`,
    );

    expect(status).toBe(200);
    expect(body.paymentIntent.id).toBe(created.body.paymentIntent.id);
  });

  test("reports a payment that has not been confirmed yet", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });

    const { body } = await harness.request("GET", `/payments/${created.body.paymentIntent.id}`);

    expect(body.paymentIntent.status).toBe("CREATED");
    expect(body.clearing).toBeNull();
    expect(body.timeline).toEqual([]);
  });
});

describe("POST /webhooks/:provider", () => {
  test("drives a pending settlement to completion", async () => {
    const harness = createApiHarness({ behaviour: "pending" });
    const created = await harness.request("POST", "/payment-intents", {
      body: { qr: qrisPayload() },
    });
    const confirmed = await harness.request(
      "POST",
      `/payment-intents/${created.body.paymentIntent.id}/confirm`,
    );
    expect(confirmed.body.clearing.state).toBe("SETTLING");

    const rawBody = JSON.stringify({
      providerReference: confirmed.body.clearing.providerReference,
      state: "SUCCEEDED",
    });

    const response = await harness.app.request("/webhooks/mock", {
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

    const payment = await harness.request("GET", `/payments/${created.body.paymentIntent.id}`);
    expect(payment.body.paymentIntent.status).toBe("COMPLETED");
  });

  test("rejects an unsigned webhook", async () => {
    const harness = createApiHarness({ behaviour: "pending" });
    const { status, body } = await harness.request("POST", "/webhooks/mock", {
      body: { providerReference: "stl_whatever", state: "SUCCEEDED" },
    });

    expect(status).toBe(400);
    expect(body.error.message).toMatch(/signature/i);
  });

  test("404s for an unregistered provider", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("POST", "/webhooks/paynow", {
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
    expect(body).toEqual({ status: "ok", settlementAsset: "IDRX", providers: ["mock"] });
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
