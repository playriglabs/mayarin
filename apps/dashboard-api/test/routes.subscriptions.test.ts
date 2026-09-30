/**
 * Subscription route + billing tick tests (#296).
 *
 * The harness clock starts at 2026-01-01; a test moves it and runs the same
 * `tick()` the dashboard API runs every minute.
 */

import { describe, expect, test } from "bun:test";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

/** Signs in afresh — moving the clock by months expires the earlier session. */
async function login(harness: Harness) {
  const res = await harness.request("POST", "/v1/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

async function seed() {
  const harness = await createDashboardHarness({
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });
  const auth = await login(harness);
  const customer = await post(harness, auth, "/v1/customers", {
    name: "PT Sumber Rejeki",
    email: "finance@sr.co.id",
  });
  return { harness, auth, customerId: customer.body?.customer?.id as string };
}

type Auth = Awaited<ReturnType<typeof login>>;

function post(harness: Harness, auth: Auth, path: string, body: unknown = {}) {
  return harness.request("POST", path, {
    body,
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

async function subscribe(harness: Harness, auth: Auth, customerId: string, startAt?: string) {
  const res = await post(harness, auth, "/v1/subscriptions", {
    customerId,
    description: "Pro plan",
    amount: { amount: "49000", asset: "IDR" },
    interval: "month",
    daysUntilDue: 7,
    ...(startAt === undefined ? {} : { startAt }),
  });
  expect(res.status).toBe(201);
  return res.body?.subscription as { id: string; nextBillingAt: string };
}

describe("subscriptions", () => {
  test("a due cycle issues one invoice and one email, however often the tick runs", async () => {
    const { harness, auth, customerId } = await seed();
    const subscription = await subscribe(harness, auth, customerId);
    expect(subscription.nextBillingAt).toBe("2026-01-01T00:00:00.000Z");

    expect(await harness.container.subscriptions.tick()).toEqual({ billed: 1, failed: 0 });
    expect(await harness.container.subscriptions.tick()).toEqual({ billed: 0, failed: 0 });

    const detail = await harness.request("GET", `/v1/subscriptions/${subscription.id}`, {
      cookies: auth.jar,
    });
    expect(detail.body?.subscription).toMatchObject({
      billedCycles: 1,
      nextBillingAt: "2026-02-01T00:00:00.000Z",
    });
    expect(detail.body?.cycles).toHaveLength(1);
    expect(detail.body?.cycles[0]).toMatchObject({
      status: "issued",
      total: { amount: "4900000", asset: "IDR" },
      dueAt: "2026-01-08T00:00:00.000Z",
    });
    expect(harness.invoiceEmailCalls).toHaveLength(1);
    expect(harness.invoiceEmailCalls[0]).toMatchObject({ buyerEmail: "finance@sr.co.id" });
  });

  test("the next month bills the next cycle", async () => {
    const { harness, auth, customerId } = await seed();
    const subscription = await subscribe(harness, auth, customerId);
    await harness.container.subscriptions.tick();

    harness.clock.set("2026-02-01T00:00:00.000Z");
    expect(await harness.container.subscriptions.tick()).toEqual({ billed: 1, failed: 0 });

    const later = await login(harness);
    const detail = await harness.request("GET", `/v1/subscriptions/${subscription.id}`, {
      cookies: later.jar,
    });
    expect(detail.body?.cycles).toHaveLength(2);
    expect(detail.body?.subscription.nextBillingAt).toBe("2026-03-01T00:00:00.000Z");
    expect(harness.invoiceEmailCalls).toHaveLength(2);
  });

  test("a future start bills nothing until its date", async () => {
    const { harness, auth, customerId } = await seed();
    await subscribe(harness, auth, customerId, "2026-01-15T00:00:00.000Z");
    expect(await harness.container.subscriptions.tick()).toEqual({ billed: 0, failed: 0 });
  });

  test("pause stops billing, resume skips the missed periods, cancel ends it", async () => {
    const { harness, auth, customerId } = await seed();
    const subscription = await subscribe(harness, auth, customerId);
    await harness.container.subscriptions.tick();

    const paused = await post(harness, auth, `/v1/subscriptions/${subscription.id}/pause`);
    expect(paused.body?.subscription).toMatchObject({ state: "paused", nextBillingAt: null });

    harness.clock.set("2026-04-10T00:00:00.000Z");
    expect(await harness.container.subscriptions.tick()).toEqual({ billed: 0, failed: 0 });

    const later = await login(harness);
    const resumed = await post(harness, later, `/v1/subscriptions/${subscription.id}/resume`);
    expect(resumed.body?.subscription).toMatchObject({
      state: "active",
      nextBillingAt: "2026-05-01T00:00:00.000Z",
    });

    const cancelled = await post(harness, later, `/v1/subscriptions/${subscription.id}/cancel`);
    expect(cancelled.body?.subscription.state).toBe("cancelled");
    const again = await post(harness, later, `/v1/subscriptions/${subscription.id}/resume`);
    expect(again.status).toBe(409);
  });

  test("an unknown customer or another merchant's subscription is a 404", async () => {
    const { harness, auth } = await seed();
    const res = await post(harness, auth, "/v1/subscriptions", {
      customerId: "cus_missing",
      description: "Pro plan",
      amount: { amount: "1", asset: "USDC" },
      interval: "month",
      daysUntilDue: 7,
    });
    expect(res.status).toBe(404);

    const missing = await harness.request("GET", "/v1/subscriptions/sub_other", {
      cookies: auth.jar,
    });
    expect(missing.status).toBe(404);
  });
});
