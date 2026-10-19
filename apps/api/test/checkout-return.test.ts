import { describe, expect, test } from "bun:test";
import { RETURN_COOKIE, returnUrlFor } from "../src/middleware/payer-access.ts";
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
  const id = created.body.paymentIntent.id as string;
  return { harness, id };
}

const visit = (
  harness: Awaited<ReturnType<typeof setup>>["harness"],
  id: string,
  cookie?: string,
) =>
  harness.app.request(`/checkout/return/${id}`, {
    headers: cookie === undefined ? {} : { cookie: `${RETURN_COOKIE}=${cookie}` },
  });

describe("the return path after a third party (SEC-09)", () => {
  test("the URL handed to the third party carries no token", async () => {
    const { harness, id } = await setup();
    const url = returnUrlFor(harness.container, id);
    expect(url).toEndWith(`/checkout/return/${id}`);
    expect(url).not.toContain("t=");
    expect(url).not.toContain(harness.payerToken(id));
  });

  test("a payer holding the cookie is sent on to their payment page", async () => {
    const { harness, id } = await setup();
    const token = harness.payerToken(id);
    const response = await visit(harness, id, token);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`/checkout/pay/${id}?t=${token}`);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("someone who only has the URL gets a 404", async () => {
    const { harness, id } = await setup();
    expect((await visit(harness, id)).status).toBe(404);
  });

  test("a token minted for another payment does not open this one", async () => {
    const { harness, id } = await setup();
    const other = await harness.request("POST", "/v1/payment-intents", {
      body: { merchant, amount: { amount: "10000.00", asset: "IDR" } },
    });
    const otherToken = harness.payerToken(other.body.paymentIntent.id);
    expect((await visit(harness, id, otherToken)).status).toBe(404);
  });
});
