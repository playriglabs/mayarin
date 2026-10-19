import { describe, expect, test } from "bun:test";
import { createApiHarness, TEST_MERCHANT_ID } from "./harness.ts";

const merchant = { id: TEST_MERCHANT_ID, name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };

async function setup() {
  const harness = createApiHarness();
  const now = new Date("2026-01-01T00:00:00Z");
  await harness.container.merchants.insert({
    id: TEST_MERCHANT_ID,
    name: "Warung Kopi",
    settlementAsset: "USDC",
    acceptedAssets: ["USDC"],
    createdAt: now,
    updatedAt: now,
    version: 1,
    city: "Jakarta",
    countryCode: "ID",
  });
  const created = await harness.request("POST", "/v1/payment-intents", {
    body: { merchant, amount: { amount: "50000.00", asset: "IDR" } },
  });
  return { harness, id: created.body.paymentIntent.id as string };
}

describe("what a payer reads of their own payment (SEC-09)", () => {
  test("the payer's token returns the status the page needs, not the operational record", async () => {
    const { harness, id } = await setup();
    const { status, body } = await harness.request(
      "GET",
      `/v1/payments/${id}?t=${harness.payerToken(id)}`,
      { auth: false },
    );

    expect(status).toBe(200);
    expect(body.paymentIntent.status).toBeDefined();
    expect(body).not.toHaveProperty("timeline");
    if (body.clearing !== null) expect(Object.keys(body.clearing)).toEqual(["state"]);
  });

  test("the owning merchant's key still reads the full record", async () => {
    const { harness, id } = await setup();
    const { status, body } = await harness.request("GET", `/v1/payments/${id}`);

    expect(status).toBe(200);
    expect(body).toHaveProperty("timeline");
  });
});
