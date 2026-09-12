/**
 * Admin users-route tests — the within-merchant account surface.
 *
 * `GET /admin/users` lists the caller's own merchant accounts (needs
 * `admin:access`). `POST /admin/users` grants a sub-account in the caller's
 * own merchant only (needs `users:manage`, CSRF-guarded). A caller with
 * `admin:access` but not `users:manage` can list but not create. The new
 * account always lands in the caller's merchant — never cross-merchant.
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
  return harness;
}

/** Inserts a user directly into the in-memory repo under the seeded merchant. */
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

async function loginAs(
  harness: Harness,
  email: string,
  password: string,
): Promise<{ jar: Record<string, string>; csrf: string }> {
  const res = await harness.request("POST", "/v1/auth/login", { body: { email, password } });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  return { jar, csrf: jar.mayarin_csrf ?? "" };
}

describe("admin users routes", () => {
  test("GET /admin/users is 401 for an anonymous caller", async () => {
    const harness = await seed();
    const res = await harness.request("GET", "/v1/admin/users");
    expect(res.status).toBe(401);
  });

  test("GET /admin/users is 403 for a merchant without admin:access", async () => {
    const harness = await seed();
    await insertUser(harness, "staff@mayarin.local", "pw-staff", ["payments:read"]);
    const { jar } = await loginAs(harness, "staff@mayarin.local", "pw-staff");
    const res = await harness.request("GET", "/v1/admin/users", { cookies: jar });
    expect(res.status).toBe(403);
  });

  test("GET /admin/users lists the caller's own merchant accounts", async () => {
    const harness = await seed();
    await insertUser(harness, "staff@mayarin.local", "pw-staff", ["payments:read"]);
    const { jar } = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("GET", "/v1/admin/users", { cookies: jar });
    expect(res.status).toBe(200);
    const emails = ((res.body?.users ?? []) as Array<{ email: string; merchantId: string }>).map(
      (u) => u.email,
    );
    expect(emails).toContain(ADMIN_EMAIL);
    expect(emails).toContain("staff@mayarin.local");
    // Every listed account is in the caller's merchant — no cross-merchant leak.
    for (const u of (res.body?.users ?? []) as Array<{ merchantId: string }>) {
      expect(u.merchantId).toBe(harness.merchantId);
    }
  });

  test("POST /admin/users without CSRF is 403", async () => {
    const harness = await seed();
    const { jar } = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("POST", "/v1/admin/users", {
      cookies: jar,
      body: { email: "new@mayarin.local", permissions: ["payments:read"] },
    });
    expect(res.status).toBe(403);
  });

  test("POST /admin/users is 403 for a caller with admin:access but not users:manage", async () => {
    const harness = await seed();
    await insertUser(harness, "op@mayarin.local", "pw-op", ["admin:access"]);
    const { jar, csrf } = await loginAs(harness, "op@mayarin.local", "pw-op");
    const res = await harness.request("POST", "/v1/admin/users", {
      cookies: jar,
      headers: { "x-csrf-token": csrf },
      body: { email: "new@mayarin.local", permissions: ["payments:read"] },
    });
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("FORBIDDEN");
  });

  test("POST /admin/users creates a same-merchant account with a supplied password", async () => {
    const harness = await seed();
    const { jar, csrf } = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("POST", "/v1/admin/users", {
      cookies: jar,
      headers: { "x-csrf-token": csrf },
      body: {
        email: "new@mayarin.local",
        password: "strong-password-1",
        permissions: ["payments:read"],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body?.user?.email).toBe("new@mayarin.local");
    expect(res.body?.user?.merchantId).toBe(harness.merchantId);
    expect(res.body?.user?.permissions).toEqual(["payments:read"]);
    // Supplied password is not echoed back.
    expect(res.body?.generatedPassword).toBeUndefined();
  });

  test("POST /admin/users generates + echoes a password when none is supplied", async () => {
    const harness = await seed();
    const { jar, csrf } = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("POST", "/v1/admin/users", {
      cookies: jar,
      headers: { "x-csrf-token": csrf },
      body: { email: "gen@mayarin.local", permissions: ["payments:read"] },
    });
    expect(res.status).toBe(201);
    expect(typeof res.body?.generatedPassword).toBe("string");
    expect((res.body?.generatedPassword ?? "").length).toBeGreaterThan(0);
  });

  test("POST /admin/users rejects a duplicate email with 409", async () => {
    const harness = await seed();
    const { jar, csrf } = await loginAs(harness, ADMIN_EMAIL, ADMIN_PASSWORD);
    const res = await harness.request("POST", "/v1/admin/users", {
      cookies: jar,
      headers: { "x-csrf-token": csrf },
      body: { email: ADMIN_EMAIL, permissions: ["payments:read"] },
    });
    expect(res.status).toBe(409);
  });
});
