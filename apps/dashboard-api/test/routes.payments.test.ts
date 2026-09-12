/**
 * Payment route tests — merchant-scoped visibility.
 *
 * Every account is merchant-scoped: a caller sees only the payment intents
 * whose `merchantId` equals its own account tenant. There is no cross-merchant
 * view — a request for another merchant's payment resolves to the same
 * `NotFoundError` as an absent id (no leakage). The old cross-merchant
 * `/v1/admin/payments` surface is gone; `/v1/admin/payments` is no longer a route, so
 * a caller with `admin:access` gets 404 and one without gets 403 (the
 * `admin:access` gate runs before route lookup).
 */

import { describe, expect, test } from "bun:test";
import type { Permission, User } from "@mayarin/auth";
import { generateId } from "@mayarin/shared";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function seed() {
  const harness = await createDashboardHarness({
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });

  const now = harness.clock.now();
  const merchantA = await makeUser(harness, now, "mch_a", "warung-a@mayarin.local", "pw-a", [
    "payments:read",
  ]);
  const merchantB = await makeUser(harness, now, "mch_b", "warung-b@mayarin.local", "pw-b", [
    "payments:read",
  ]);

  const intentA = await harness.intentService.create({
    merchant: { id: "mch_a", name: "Warung A", city: "Jakarta", countryCode: "ID" },
    amount: { amount: 50_000n, asset: "IDR" },
    source: { type: "manual" },
  });
  const intentB = await harness.intentService.create({
    merchant: { id: "mch_b", name: "Warung B", city: "Bandung", countryCode: "ID" },
    amount: { amount: 75_000n, asset: "IDR" },
    source: { type: "manual" },
  });

  return { harness, merchantA, merchantB, intentA, intentB };
}

async function makeUser(
  harness: Harness,
  now: Date,
  merchantId: string,
  email: string,
  password: string,
  permissions: readonly Permission[],
): Promise<User> {
  const user: User = {
    id: generateId("usr", now.getTime()),
    email,
    passwordHash: `plain:${password}`,
    merchantId,
    permissions: [...permissions],
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await harness.users.insert(user);
  return user;
}

async function loginAs(
  harness: Harness,
  email: string,
  password: string,
): Promise<Record<string, string>> {
  const res = await harness.request("POST", "/v1/auth/login", { body: { email, password } });
  expect(res.status).toBe(200);
  return cookieJar(res.setCookies);
}

describe("payment routes", () => {
  test("an anonymous request to /payments is 401", async () => {
    const { harness } = await seed();
    const res = await harness.request("GET", "/v1/payments");
    expect(res.status).toBe(401);
  });

  test("a merchant sees only their own intents", async () => {
    const { harness, intentA } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const res = await harness.request("GET", "/v1/payments", { cookies: jar });
    expect(res.status).toBe(200);
    const ids = ((res.body?.payments ?? []) as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toEqual([intentA.id]);
  });

  test("a second merchant sees only its own intents", async () => {
    const { harness, intentB } = await seed();
    const jar = await loginAs(harness, "warung-b@mayarin.local", "pw-b");
    const res = await harness.request("GET", "/v1/payments", { cookies: jar });
    expect(res.status).toBe(200);
    const ids = ((res.body?.payments ?? []) as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toEqual([intentB.id]);
  });

  test("search, status, sort, and cursor stay inside the caller's merchant", async () => {
    const { harness, intentA, intentB } = await seed();
    const second = await harness.intentService.create({
      merchant: { id: "mch_a", name: "Warung A", city: "Jakarta", countryCode: "ID" },
      amount: { amount: 125_000n, asset: "IDR" },
      source: { type: "manual" },
      merchantReference: "ORDER-437",
    });
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");

    const search = await harness.request(
      "GET",
      "/v1/payments?q=ORDER-437&status=CREATED&sort=-amount&merchantId=mch_b",
      { cookies: jar },
    );
    expect(search.status).toBe(200);
    expect(((search.body?.payments ?? []) as Array<{ id: string }>).map((row) => row.id)).toEqual([
      second.id,
    ]);
    expect(
      ((search.body?.payments ?? []) as Array<{ id: string }>).map((row) => row.id),
    ).not.toContain(intentB.id);

    const firstPage = await harness.request("GET", "/v1/payments?limit=1&sort=-created", {
      cookies: jar,
    });
    expect(firstPage.status).toBe(200);
    expect(((firstPage.body?.payments ?? []) as unknown[]).length).toBe(1);
    expect(typeof firstPage.body?.nextCursor).toBe("string");

    const secondPage = await harness.request(
      "GET",
      `/v1/payments?limit=1&sort=-created&cursor=${encodeURIComponent(String(firstPage.body?.nextCursor))}`,
      { cookies: jar },
    );
    expect(secondPage.status).toBe(200);
    const pageIds = ((secondPage.body?.payments ?? []) as Array<{ id: string }>).map(
      (row) => row.id,
    );
    expect(pageIds).toHaveLength(1);
    expect(pageIds).toContain(intentA.id);
    expect(pageIds).not.toContain(intentB.id);
  });

  test("a cross-merchant payment detail is 404, not 403", async () => {
    const { harness, intentB } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const res = await harness.request("GET", `/v1/payments/${intentB.id}`, { cookies: jar });
    expect(res.status).toBe(404);
  });

  test("a merchant can read their own payment detail", async () => {
    const { harness, intentA } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const res = await harness.request("GET", `/v1/payments/${intentA.id}`, { cookies: jar });
    expect(res.status).toBe(200);
    expect(res.body?.paymentIntent?.id).toBe(intentA.id);
  });

  test("a past-due CREATED intent reads as EXPIRED on detail and list views", async () => {
    const { harness } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const created = await harness.intentService.create({
      merchant: { id: "mch_a", name: "Warung A", city: "Jakarta", countryCode: "ID" },
      amount: { amount: 50_000n, asset: "IDR" },
      source: { type: "manual" },
    });

    // Before the deadline the intent is still CREATED.
    const before = await harness.request("GET", `/v1/payments/${created.id}`, { cookies: jar });
    expect(before.body?.paymentIntent?.status).toBe("CREATED");

    // Step past the 900s TTL. The dashboard has no write path, so this is a read
    // projection — the persisted row stays CREATED; the view says EXPIRED.
    harness.clock.advance(900_000 + 1);

    const detail = await harness.request("GET", `/v1/payments/${created.id}`, { cookies: jar });
    expect(detail.body?.paymentIntent?.status).toBe("EXPIRED");

    const list = await harness.request("GET", "/v1/payments", { cookies: jar });
    const row = ((list.body?.payments ?? []) as Array<{ id: string; status: string }>).find(
      (p) => p.id === created.id,
    );
    expect(row?.status).toBe("EXPIRED");
  });

  test("the merchant-admin (own tenant) sees no intents created under other merchants", async () => {
    const { harness, intentA, intentB } = await seed();
    const jar = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("GET", "/v1/payments", { cookies: jar });
    expect(res.status).toBe(200);
    const ids = ((res.body?.payments ?? []) as Array<{ id: string }>).map((p) => p.id);
    // The seeded merchant-admin's tenant (mrc_…) has no intents; cross-merchant
    // intents are invisible. No cross-merchant view exists.
    expect(ids).toEqual([]);
    expect(ids).not.toContain(intentA.id);
    expect(ids).not.toContain(intentB.id);
  });

  test("/v1/admin/payments is 403 for a merchant without admin:access", async () => {
    const { harness } = await seed();
    const jar = await loginAs(harness, "warung-a@mayarin.local", "pw-a");
    const res = await harness.request("GET", "/v1/admin/payments", { cookies: jar });
    expect(res.status).toBe(403);
  });

  test("/v1/admin/payments is 404 for a caller with admin:access (route removed)", async () => {
    const { harness } = await seed();
    const jar = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("GET", "/v1/admin/payments", { cookies: jar });
    expect(res.status).toBe(404);
  });

  test("/v1/admin/payments is 401 for an anonymous caller", async () => {
    const { harness } = await seed();
    const res = await harness.request("GET", "/v1/admin/payments");
    expect(res.status).toBe(401);
  });
});
