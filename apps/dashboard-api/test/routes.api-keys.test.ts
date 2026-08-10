/**
 * API key route tests — bearer-token auth, per-key permissions.
 *
 * Closes the criterion: a merchant mints a key, the secret is shown once, and
 * the key reaches exactly the surfaces its permissions allow — no session, no
 * CSRF token. A revoked key is a 401, indistinguishable from an absent one.
 */

import { describe, expect, test } from "bun:test";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

type Harness = Awaited<ReturnType<typeof createDashboardHarness>>;

async function seed() {
  const harness = await createDashboardHarness({
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });
  const auth = await login(harness);
  return { harness, auth };
}

async function login(harness: Harness) {
  const res = await harness.request("POST", "/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

async function bearer(
  harness: Harness,
  method: string,
  path: string,
  token: string,
  body?: unknown,
) {
  return harness.request(method, path, {
    headers: { authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body }),
  });
}

describe("POST /api-keys", () => {
  test("creates a key and returns the secret exactly once", async () => {
    const { harness, auth } = await seed();
    const res = await harness.request("POST", "/api-keys", {
      body: { name: "POS register 3", permissions: ["payments:read"] },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(res.status).toBe(201);
    expect(res.body?.apiKey.name).toBe("POS register 3");
    expect(res.body?.apiKey.prefix).toMatch(/^pk_[0-9a-f]{9}$/);
    expect(res.body?.secret).toMatch(/^pk_[0-9a-f]{64}$/);
    // The listing never shows the secret.
    const listed = await harness.request("GET", "/api-keys", { cookies: auth.jar });
    expect(listed.body?.apiKeys[0].secret).toBeUndefined();
  });

  test("without a CSRF token is refused (session path)", async () => {
    const { harness, auth } = await seed();
    const res = await harness.request("POST", "/api-keys", {
      body: { name: "K", permissions: ["payments:read"] },
      cookies: auth.jar,
    });
    expect(res.status).toBe(403);
  });

  test("a permission the caller cannot grant is refused at the schema", async () => {
    const { harness, auth } = await seed();
    const res = await harness.request("POST", "/api-keys", {
      body: { name: "K", permissions: ["not-a-permission"] },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api-keys", () => {
  test("filters by name and active status", async () => {
    const { harness, auth } = await seed();
    await harness.request("POST", "/api-keys", {
      body: { name: "Production reader", permissions: ["payments:read"] },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    await harness.request("POST", "/api-keys", {
      body: { name: "Development reader", permissions: ["payments:read"] },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });

    const res = await harness.request("GET", "/api-keys?q=production&status=active", {
      cookies: auth.jar,
    });
    expect(res.body?.apiKeys.map((key: { name: string }) => key.name)).toEqual([
      "Production reader",
    ]);
  });
});

describe("bearer auth", () => {
  test("a key with payments:read reaches /orders without a session or CSRF token", async () => {
    const { harness, auth } = await seed();
    const created = await harness.request("POST", "/api-keys", {
      body: { name: "Reader", permissions: ["payments:read"] },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    const secret = created.body?.secret;

    const res = await bearer(harness, "GET", "/orders", secret);
    expect(res.status).toBe(200);
    expect(res.body?.orders).toEqual([]);
  });

  test("a key without the route's permission is 403", async () => {
    const { harness, auth } = await seed();
    // payments:read does not open the settings:manage /api-keys write surface.
    const created = await harness.request("POST", "/api-keys", {
      body: { name: "Reader", permissions: ["payments:read"] },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    const secret = created.body?.secret;

    const res = await bearer(harness, "POST", "/api-keys", secret, {
      name: "Another",
      permissions: ["payments:read"],
    });
    expect(res.status).toBe(403);
  });

  test("CSRF is skipped for a bearer mutating request with the right permission", async () => {
    const { harness, auth } = await seed();
    // Mint a key that itself holds settings:manage, so it may create keys.
    const created = await harness.request("POST", "/api-keys", {
      body: { name: "Manager", permissions: ["settings:manage"] },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    const secret = created.body?.secret;

    // No CSRF token, no cookie — only the bearer header.
    const res = await bearer(harness, "POST", "/api-keys", secret, {
      name: "Child",
      permissions: ["payments:read"],
    });
    expect(res.status).toBe(201);
    expect(res.body?.apiKey.name).toBe("Child");
  });

  test("a deactivated key is 401, indistinguishable from an absent token", async () => {
    const { harness, auth } = await seed();
    const created = await harness.request("POST", "/api-keys", {
      body: { name: "Old", permissions: ["payments:read"] },
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    const secret = created.body?.secret;
    const id = created.body?.apiKey.id;

    const deactivated = await harness.request("DELETE", `/api-keys/${id}`, {
      cookies: auth.jar,
      headers: { "x-csrf-token": auth.csrf },
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body?.apiKey.active).toBe(false);

    const before = await bearer(harness, "GET", "/orders", "pk_not_a_real_key");
    const after = await bearer(harness, "GET", "/orders", secret);
    expect(after.status).toBe(before.status);
    expect(after.status).toBe(401);
  });

  test("an unknown bearer scheme is not authenticated", async () => {
    const { harness } = await seed();
    const res = await harness.request("GET", "/orders", {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });
});
