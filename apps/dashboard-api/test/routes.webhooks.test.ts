/**
 * Merchant webhook route tests (#13).
 *
 * The criterion this closes is *"a merchant can list their recent deliveries
 * with response status, and replay one"* — behind their own session, not an
 * admin token. Most of what is under test is refusal, because a delivery body
 * carries payment detail: the wrong permission, the wrong merchant, a missing
 * CSRF token, a URL pointing inward.
 */

import { describe, expect, test } from "bun:test";
import type { Permission, User } from "@mayarin/auth";
import type { WebhookDelivery } from "@mayarin/notifications";
import { generateId } from "@mayarin/shared";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";
const URL = "https://hooks.example.com/mayarin";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function seed() {
  return createDashboardHarness({ adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD });
}

async function loginAs(harness: Harness, email: string, password: string) {
  const res = await harness.request("POST", "/v1/auth/login", { body: { email, password } });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

type Auth = Awaited<ReturnType<typeof loginAs>>;

async function post(harness: Harness, auth: Auth, path: string, body: unknown = {}) {
  return harness.request("POST", path, {
    body,
    cookies: auth.jar,
    headers: { "x-csrf-token": auth.csrf },
  });
}

async function insertUser(
  harness: Harness,
  email: string,
  password: string,
  permissions: readonly Permission[],
): Promise<User> {
  const now = harness.clock.now();
  const user: User = {
    id: generateId("usr", now.getTime()),
    email,
    passwordHash: `plain:${password}`,
    merchantId: harness.merchantId,
    permissions: [...permissions],
    emailVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await harness.users.insert(user);
  return user;
}

/** A delivery already recorded against a merchant, as the dispatcher would leave one. */
async function seedDelivery(
  harness: Harness,
  merchantId: string,
  overrides: Partial<WebhookDelivery> = {},
): Promise<WebhookDelivery> {
  const now = harness.clock.now();
  const delivery: WebhookDelivery = {
    id: generateId("whd", now.getTime()),
    eventId: generateId("evt", now.getTime()),
    endpointId: generateId("whe", now.getTime()),
    merchantId,
    body: '{"type":"payment.state_changed"}',
    status: "DEAD",
    attempts: 5,
    lastStatusCode: 500,
    lastError: "receiver returned 500",
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await harness.webhookDeliveries.insertMany([delivery]);
  return delivery;
}

describe("endpoints", () => {
  test("registers one and returns the secret exactly once", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const created = await post(harness, auth, "/v1/webhooks/endpoints", { url: URL });

    expect(created.status).toBe(201);
    expect(created.body?.secret).toMatch(/^whsec_/);
    expect(created.body?.endpoint.url).toBe(URL);

    const listed = await harness.request("GET", "/v1/webhooks/endpoints", { cookies: auth.jar });
    expect(listed.body?.endpoints).toHaveLength(1);
    // The listing must never show it again.
    expect(listed.body?.endpoints[0].secret).toBeUndefined();
  });

  test("a second active endpoint is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    await post(harness, auth, "/v1/webhooks/endpoints", { url: URL });
    const second = await post(harness, auth, "/v1/webhooks/endpoints", {
      url: "https://hooks.example.com/other",
    });

    expect(second.status).toBe(409);
  });

  test("a private-network URL is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { status } = await post(harness, auth, "/v1/webhooks/endpoints", {
      url: "https://127.0.0.1/hook",
    });
    expect(status).toBe(400);
  });

  test("a plain-HTTP URL is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { status } = await post(harness, auth, "/v1/webhooks/endpoints", {
      url: "http://hooks.example.com/hook",
    });
    expect(status).toBe(400);
  });

  test("rotation keeps the previous secret valid", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/webhooks/endpoints", { url: URL });
    const first = created.body?.secret;

    const rotated = await post(
      harness,
      auth,
      `/v1/webhooks/endpoints/${created.body?.endpoint.id}/rotate`,
    );

    expect(rotated.body?.secret).not.toBe(first);
    // Without the overlap a rotation drops every delivery in flight.
    expect(rotated.body?.endpoint.rotatedSecretActive).toBe(true);
  });

  test("deactivating frees the slot", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const created = await post(harness, auth, "/v1/webhooks/endpoints", { url: URL });

    await post(harness, auth, `/v1/webhooks/endpoints/${created.body?.endpoint.id}/deactivate`);
    const again = await post(harness, auth, "/v1/webhooks/endpoints", { url: URL });

    expect(again.status).toBe(201);
  });
});

describe("deliveries", () => {
  test("lists the merchant's own, with what the receiver answered", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    await seedDelivery(harness, harness.merchantId);

    const { status, body } = await harness.request("GET", "/v1/webhooks/deliveries", {
      cookies: auth.jar,
    });

    expect(status).toBe(200);
    expect(body?.deliveries).toHaveLength(1);
    // A dead-lettered delivery a merchant cannot see is a payment they silently
    // miss, so the status and the receiver's answer both have to be visible.
    expect(body?.deliveries[0]).toMatchObject({
      status: "DEAD",
      attempts: 5,
      lastStatusCode: 500,
    });
  });

  test("replaying re-queues without changing the body", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const delivery = await seedDelivery(harness, harness.merchantId);

    const { status, body } = await post(
      harness,
      auth,
      `/v1/webhooks/deliveries/${delivery.id}/replay`,
    );

    expect(status).toBe(202);
    expect(body?.delivery).toMatchObject({ status: "PENDING", attempts: 0 });
    // Same bytes, same Webhook-Id — a replay is a second attempt at one
    // delivery, never a second event.
    expect(body?.delivery.body).toBe(delivery.body);
  });

  test("a replay without a CSRF token is refused", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const delivery = await seedDelivery(harness, harness.merchantId);

    const { status } = await harness.request(
      "POST",
      `/v1/webhooks/deliveries/${delivery.id}/replay`,
      {
        cookies: auth.jar,
      },
    );
    expect(status).toBe(403);
  });

  test("filters and paginates deliveries with opaque cursors", async () => {
    const harness = await seed();
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const now = harness.clock.now();
    await seedDelivery(harness, harness.merchantId, {
      id: "whd_keep_1",
      eventId: "evt_keep_1",
      endpointId: "whe_keep_1",
      createdAt: new Date(now.getTime() - 1_000),
    });
    await seedDelivery(harness, harness.merchantId, {
      id: "whd_keep_2",
      eventId: "evt_keep_2",
      endpointId: "whe_keep_2",
    });

    const first = await harness.request(
      "GET",
      "/v1/webhooks/deliveries?q=keep&status=DEAD&limit=1",
      {
        cookies: auth.jar,
      },
    );
    expect(first.body?.deliveries).toHaveLength(1);
    expect(typeof first.body?.nextCursor).toBe("string");

    const second = await harness.request(
      "GET",
      `/v1/webhooks/deliveries?q=keep&status=DEAD&limit=1&cursor=${encodeURIComponent(String(first.body?.nextCursor))}`,
      { cookies: auth.jar },
    );
    expect(second.body?.deliveries).toHaveLength(1);
    expect(second.body?.deliveries[0].id).not.toBe(first.body?.deliveries[0].id);
  });
});

describe("cross-tenant isolation", () => {
  test("another merchant's deliveries are invisible", async () => {
    const harness = await seed();
    await seedDelivery(harness, "mrc_someone_else");
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { body } = await harness.request("GET", "/v1/webhooks/deliveries", { cookies: auth.jar });
    expect(body?.deliveries).toEqual([]);
  });

  test("another merchant's delivery cannot be replayed, and reads as not-found", async () => {
    const harness = await seed();
    const theirs = await seedDelivery(harness, "mrc_someone_else");
    const auth = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);

    const { status } = await post(harness, auth, `/v1/webhooks/deliveries/${theirs.id}/replay`);

    // 404 rather than 403: a 403 confirms the id exists, which is the one bit a
    // caller should not learn from an id they were never given.
    expect(status).toBe(404);
  });
});

describe("permissions", () => {
  test("an anonymous caller is refused", async () => {
    const harness = await seed();
    const { status } = await harness.request("GET", "/v1/webhooks/deliveries");
    expect(status).toBe(401);
  });

  test("a caller without settings:manage is refused", async () => {
    const harness = await seed();
    await insertUser(harness, "reader@mayarin.local", "reader-password-1", [
      "payments:read",
      "admin:access",
    ]);
    const auth = await loginAs(harness, "reader@mayarin.local", "reader-password-1");

    const { status } = await harness.request("GET", "/v1/webhooks/deliveries", {
      cookies: auth.jar,
    });
    expect(status).toBe(403);
  });
});
