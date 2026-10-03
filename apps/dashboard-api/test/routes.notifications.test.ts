/**
 * Notification route tests — the bell.
 *
 * The feed is derived in the Drizzle adapter; the in-memory store hands back
 * what a test seeds, so these check what the edge adds: merchant scope, the
 * wording and links per type, the per-account seen mark, and that
 * configuration notices stay with settings managers.
 */

import { describe, expect, test } from "bun:test";
import type { Permission, User } from "@mayarin/auth";
import { generateId, numericReference } from "@mayarin/shared";
import { cookieJar, createDashboardHarness } from "./harness.ts";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

async function login(harness: Harness, email: string, password: string) {
  const res = await harness.request("POST", "/v1/auth/login", { body: { email, password } });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

async function seed() {
  const harness = await createDashboardHarness({
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });
  const store = harness.notificationStore;
  store.seed(harness.merchantId, {
    id: "payment.received:evt_1",
    type: "payment.received",
    occurredAt: new Date("2025-12-31T10:00:00.000Z"),
    paymentIntentId: "pi_01J0000000000000000000000A",
    amount: { amount: 5_000_000n, asset: "IDR" },
  });
  store.seed(harness.merchantId, {
    id: "payment.paid:evt_2",
    type: "payment.paid",
    occurredAt: new Date("2025-12-31T11:00:00.000Z"),
    paymentIntentId: "pi_01J0000000000000000000000A",
    amount: { amount: 3_100_000n, asset: "USDC" },
  });
  store.seed(harness.merchantId, {
    id: "dispute.opened:dsp_1",
    type: "dispute.opened",
    occurredAt: new Date("2025-12-31T12:00:00.000Z"),
    paymentIntentId: "pi_01J0000000000000000000000B",
    disputeId: "dsp_1",
    detail: "2026-01-07T12:00:00.000Z",
  });
  store.seed(harness.merchantId, {
    id: "security.settlement_address:msc_1",
    type: "security.settlement_address",
    occurredAt: new Date("2025-12-31T13:00:00.000Z"),
    detail: "settlementAddress",
    actor: ADMIN_EMAIL,
  });
  store.seed("mch_other", {
    id: "payment.failed:evt_9",
    type: "payment.failed",
    occurredAt: new Date("2025-12-31T14:00:00.000Z"),
    paymentIntentId: "pi_other",
  });
  return harness;
}

async function insertUser(harness: Harness, email: string, permissions: readonly Permission[]) {
  const now = harness.clock.now();
  const user: User = {
    id: generateId("usr", now.getTime()),
    email,
    passwordHash: "plain:reader-password",
    merchantId: harness.merchantId,
    permissions: [...permissions],
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await harness.users.insert(user);
}

describe("GET /notifications", () => {
  test("an anonymous request is 401", async () => {
    const harness = await seed();
    expect((await harness.request("GET", "/v1/notifications")).status).toBe(401);
  });

  test("lists the merchant's own notifications, newest first, all unread", async () => {
    const harness = await seed();
    const { jar } = await login(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("GET", "/v1/notifications", { cookies: jar });
    expect(res.status).toBe(200);
    const types = res.body?.notifications.map((n: { type: string }) => n.type);
    expect(types).toEqual([
      "security.settlement_address",
      "dispute.opened",
      "payment.paid",
      "payment.received",
    ]);
    expect(res.body?.unread).toBe(4);
  });

  test("names the payment by its reference and links to it", async () => {
    const harness = await seed();
    const { jar } = await login(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("GET", "/v1/notifications", { cookies: jar });
    const byType = (type: string) =>
      res.body?.notifications.find((n: { type: string }) => n.type === type);
    const reference = numericReference("pi_01J0000000000000000000000A");

    const paid = byType("payment.paid");
    expect(paid.title).toStartWith("🎉 You got paid");
    expect(paid.body).toBe(`Payment #${reference} completed with no dispute.`);
    expect(paid.href).toBe("/payments/pi_01J0000000000000000000000A");
    expect(paid.amount.asset).toBe("USDC");

    const disputed = byType("dispute.opened");
    expect(disputed.title).toBe(
      `Payment #${numericReference("pi_01J0000000000000000000000B")} got disputed`,
    );
    expect(disputed.href).toBe("/disputes/dsp_1");
    expect(disputed.tone).toBe("warning");
  });

  test("an account that only reads payments does not see configuration notices", async () => {
    const harness = await seed();
    await insertUser(harness, "reader@mayarin.local", ["payments:read"]);
    const { jar } = await login(harness, "reader@mayarin.local", "reader-password");
    const res = await harness.request("GET", "/v1/notifications", { cookies: jar });
    expect(res.status).toBe(200);
    const types = res.body?.notifications.map((n: { type: string }) => n.type);
    expect(types).not.toContain("security.settlement_address");
    expect(types).toHaveLength(3);
  });
});

describe("POST /notifications/read", () => {
  test("needs the CSRF token", async () => {
    const harness = await seed();
    const { jar } = await login(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("POST", "/v1/notifications/read", { cookies: jar });
    expect(res.status).toBe(403);
  });

  test("marks everything read for this account only", async () => {
    const harness = await seed();
    await insertUser(harness, "teammate@mayarin.local", ["payments:read", "settings:manage"]);
    const admin = await login(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const teammate = await login(harness, "teammate@mayarin.local", "reader-password");

    const marked = await harness.request("POST", "/v1/notifications/read", {
      cookies: admin.jar,
      headers: { "x-csrf-token": admin.csrf },
    });
    expect(marked.status).toBe(204);

    const mine = await harness.request("GET", "/v1/notifications", { cookies: admin.jar });
    expect(mine.body?.unread).toBe(0);
    expect(mine.body?.notifications.every((n: { unread: boolean }) => !n.unread)).toBe(true);

    const theirs = await harness.request("GET", "/v1/notifications", { cookies: teammate.jar });
    expect(theirs.body?.unread).toBe(4);
  });
});

describe("GET /notifications paging", () => {
  test("pages by limit with an offset cursor; unread counts the whole feed", async () => {
    const harness = await seed();
    const { jar } = await login(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const first = await harness.request("GET", "/v1/notifications?limit=3", { cookies: jar });
    expect(first.body?.notifications).toHaveLength(3);
    expect(first.body?.unread).toBe(4);
    expect(first.body?.nextCursor).toBe("3");

    const second = await harness.request("GET", "/v1/notifications?limit=3&cursor=3", {
      cookies: jar,
    });
    const types = second.body?.notifications.map((n: { type: string }) => n.type);
    expect(types).toEqual(["payment.received"]);
    expect(second.body?.nextCursor).toBeNull();
  });

  test("a category filter applies before paging", async () => {
    const harness = await seed();
    const { jar } = await login(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("GET", "/v1/notifications?category=payment&limit=10", {
      cookies: jar,
    });
    const types = res.body?.notifications.map((n: { type: string }) => n.type);
    expect(types).toEqual(["payment.paid", "payment.received"]);
    expect(res.body?.unread).toBe(4);
  });
});
