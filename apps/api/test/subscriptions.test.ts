import { describe, expect, test } from "bun:test";
import { createApiHarness, TEST_MERCHANT_ID } from "./harness.ts";

const merchant = { id: TEST_MERCHANT_ID, name: "Acme SaaS", city: "Singapore", countryCode: "SG" };

function subscriptionBody(overrides: Record<string, unknown> = {}) {
  return {
    customer: { name: "Ayu Lestari", email: "ayu@example.com" },
    description: "Pro plan",
    amount: { amount: "29.00", asset: "USD" },
    interval: "month",
    ...overrides,
  };
}

async function createSubscription(
  harness: ReturnType<typeof createApiHarness>,
  overrides: Record<string, unknown> = {},
) {
  const { status, body } = await harness.request("POST", "/v1/subscriptions", {
    body: subscriptionBody(overrides),
  });
  expect(status).toBe(201);
  return body.subscription;
}

describe("POST /subscriptions", () => {
  test("creates an active monthly plan that bills from now", async () => {
    const harness = createApiHarness();
    const subscription = await createSubscription(harness);

    expect(subscription.id).toStartWith("sub_");
    expect(subscription.state).toBe("active");
    expect(subscription.interval).toBe("month");
    expect(subscription.amount.amount).toBe("2900");
    expect(subscription.billedCycles).toBe(0);
    expect(subscription.daysUntilDue).toBe(7);
    expect(subscription.subscriber).toMatchObject({
      name: "Ayu Lestari",
      email: "ayu@example.com",
    });
    expect(subscription.subscriber.customerId).toStartWith("cus_");
    expect(subscription.nextBillingAt).toBe(subscription.anchorAt);
  });

  test("reuses the merchant's customer with the same email", async () => {
    const harness = createApiHarness();
    const first = await createSubscription(harness);
    const second = await createSubscription(harness, { description: "Add-on seats" });

    expect(second.id).not.toBe(first.id);
    expect(second.subscriber.customerId).toBe(first.subscriber.customerId);
  });

  test("starts billing at a future startAt", async () => {
    const harness = createApiHarness();
    const startAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const subscription = await createSubscription(harness, { startAt });

    expect(subscription.nextBillingAt).toBe(startAt);
  });

  test("rejects a subscriber without an email", async () => {
    const harness = createApiHarness();
    const { status } = await harness.request("POST", "/v1/subscriptions", {
      body: subscriptionBody({ customer: { name: "No Email" } }),
    });
    expect(status).toBe(400);
  });

  test("needs a key that grants catalog:manage", async () => {
    const harness = createApiHarness();
    const readOnly = harness.mintApiKey(TEST_MERCHANT_ID, "mak_read_only", ["payments:read"]);
    const { status } = await harness.request("POST", "/v1/subscriptions", {
      body: subscriptionBody(),
      auth: readOnly,
    });
    expect(status).toBe(403);
  });
});

describe("GET /subscriptions", () => {
  test("lists only the caller's subscriptions", async () => {
    const harness = createApiHarness();
    const own = await createSubscription(harness);
    const foreign = harness.mintApiKey("mrc_2", "mak_other_merchant");
    await harness.request("POST", "/v1/subscriptions", { body: subscriptionBody(), auth: foreign });

    const { status, body } = await harness.request("GET", "/v1/subscriptions");
    expect(status).toBe(200);
    expect(body.subscriptions.map((row: { id: string }) => row.id)).toEqual([own.id]);
  });
});

describe("GET /subscriptions/:id", () => {
  test("returns the cycles billed on it, each with its pay URL", async () => {
    const harness = createApiHarness();
    const subscription = await createSubscription(harness);

    // What the billing tick does each cycle: an invoice tagged with the subscription.
    await harness.request("POST", "/v1/invoices", {
      body: {
        merchantId: TEST_MERCHANT_ID,
        merchant,
        buyer: { name: "Ayu Lestari", email: "ayu@example.com" },
        currency: "USD",
        lines: [{ name: "Pro plan", unitPrice: { amount: "29.00", asset: "USD" }, quantity: 1 }],
        metadata: { subscriptionId: subscription.id },
      },
    });

    const { status, body } = await harness.request("GET", `/v1/subscriptions/${subscription.id}`);
    expect(status).toBe(200);
    expect(body.subscription.id).toBe(subscription.id);
    expect(body.cycles).toHaveLength(1);
    expect(body.cycles[0].metadata.subscriptionId).toBe(subscription.id);
    expect(body.cycles[0].url).toContain("/invoices/");
  });

  test("answers 404 for another merchant's subscription", async () => {
    const harness = createApiHarness();
    const subscription = await createSubscription(harness);
    const foreign = harness.mintApiKey("mrc_2", "mak_other_merchant");

    const { status } = await harness.request("GET", `/v1/subscriptions/${subscription.id}`, {
      auth: foreign,
    });
    expect(status).toBe(404);
  });
});

describe("pause, resume, cancel", () => {
  test("pausing clears the next bill and resuming restores one", async () => {
    const harness = createApiHarness();
    const subscription = await createSubscription(harness);

    const paused = await harness.request("POST", `/v1/subscriptions/${subscription.id}/pause`);
    expect(paused.body.subscription.state).toBe("paused");
    expect(paused.body.subscription.nextBillingAt).toBeNull();

    const resumed = await harness.request("POST", `/v1/subscriptions/${subscription.id}/resume`);
    expect(resumed.body.subscription.state).toBe("active");
    expect(resumed.body.subscription.nextBillingAt).not.toBeNull();
  });

  test("a cancelled subscription cannot be resumed", async () => {
    const harness = createApiHarness();
    const subscription = await createSubscription(harness);

    const cancelled = await harness.request("POST", `/v1/subscriptions/${subscription.id}/cancel`);
    expect(cancelled.body.subscription.state).toBe("cancelled");
    expect(cancelled.body.subscription.cancelledAt).not.toBeNull();

    const { status } = await harness.request("POST", `/v1/subscriptions/${subscription.id}/resume`);
    expect(status).toBe(409);
  });
});
