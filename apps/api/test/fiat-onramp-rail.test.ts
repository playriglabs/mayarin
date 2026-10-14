import { describe, expect, test } from "bun:test";
import type { TransfiClient } from "@mayarin/provider-transfi";
import { createApiHarness, TEST_MERCHANT_ID } from "./harness.ts";

const merchant = { id: TEST_MERCHANT_ID, name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };
const RAILS = [
  { chain: "ethereum-sepolia", asset: "USDC", settlementAsset: "USDC" },
  { chain: "base-sepolia", asset: "USDC", settlementAsset: "USDC" },
  { chain: "arc-testnet", asset: "USDC", settlementAsset: "USDC" },
];

async function setup(localCurrencyChain?: string) {
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
    ...(localCurrencyChain === undefined
      ? {}
      : { localCurrencyChain: localCurrencyChain as never }),
  });

  // TransFi on, against its sandbox, so the testnet rails are candidates.
  Object.assign(harness.container, {
    transfi: {} as TransfiClient,
    config: {
      ...harness.container.config,
      transfiBaseUrl: "https://sandbox-api.transfi.com",
    },
  });

  const created = await harness.request("POST", "/v1/payment-intents", {
    body: { merchant, amount: { amount: "50000.00", asset: "IDR" } },
  });
  return { harness, paymentId: created.body.paymentIntent.id as string };
}

describe("POST /v1/fiat-onramp/rail", () => {
  test("without a merchant preference, the cheaper supported chain wins", async () => {
    const { harness, paymentId } = await setup();

    const { status, body } = await harness.request("POST", "/v1/fiat-onramp/rail", {
      auth: false,
      body: { paymentId, rails: RAILS },
    });

    expect(status).toBe(200);
    expect(body.rail.chain).toBe("base-sepolia");
  });

  test("the merchant's chosen chain outranks the default", async () => {
    const { harness, paymentId } = await setup("ethereum-sepolia");

    const { body } = await harness.request("POST", "/v1/fiat-onramp/rail", {
      auth: false,
      body: { paymentId, rails: RAILS },
    });

    expect(body.rail.chain).toBe("ethereum-sepolia");
  });

  test("a chain the provider cannot deliver to is never chosen, even when named", async () => {
    const { harness, paymentId } = await setup("arc-testnet");

    const { body } = await harness.request("POST", "/v1/fiat-onramp/rail", {
      auth: false,
      body: { paymentId, rails: RAILS },
    });

    expect(body.rail.chain).toBe("base-sepolia");
  });

  test("offers nothing when none of the rails can be delivered to", async () => {
    const { harness, paymentId } = await setup();

    const { body } = await harness.request("POST", "/v1/fiat-onramp/rail", {
      auth: false,
      body: {
        paymentId,
        rails: [{ chain: "arc-testnet", asset: "USDC", settlementAsset: "USDC" }],
      },
    });

    expect(body.rail).toBeNull();
  });

  test("needs exactly one of a link or a payment", async () => {
    const { harness, paymentId } = await setup();

    const neither = await harness.request("POST", "/v1/fiat-onramp/rail", {
      auth: false,
      body: { rails: RAILS },
    });
    const both = await harness.request("POST", "/v1/fiat-onramp/rail", {
      auth: false,
      body: { paymentId, linkId: "lnk_1", rails: RAILS },
    });

    expect(neither.status).toBe(400);
    expect(both.status).toBe(400);
  });

  test("is a 404 when TransFi is not configured", async () => {
    const harness = createApiHarness();

    const { status } = await harness.request("POST", "/v1/fiat-onramp/rail", {
      auth: false,
      body: { paymentId: "pi_x", rails: RAILS },
    });

    expect(status).toBe(404);
  });
});

describe("GET /v1/fiat-onramp/currencies", () => {
  test("offers what the provider takes and the platform supports, and nothing else", async () => {
    const harness = createApiHarness();
    Object.assign(harness.container, {
      transfi: {
        // PHP and IDR are Mayarin currencies; NGN is the provider's but not ours.
        listDepositCurrencies: async () => ["PHP", "NGN", "IDR", "ZZZ"],
      } as unknown as TransfiClient,
    });

    const { status, body } = await harness.request("GET", "/v1/fiat-onramp/currencies", {
      auth: false,
    });

    expect(status).toBe(200);
    expect(body.currencies).toEqual(["PHP", "IDR"]);
  });
});
