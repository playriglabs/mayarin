/**
 * Auth route tests — the full cookie lifecycle through the Hono app.
 *
 * Covers login issuance, cookie flags (session HttpOnly, CSRF JS-readable), the
 * `/auth/me` mirror, CSRF enforcement on logout, and cookie clearing on logout.
 */

import { describe, expect, test } from "bun:test";
import { cookieJar, createDashboardHarness, parseSetCookie } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

async function seededHarness() {
  return createDashboardHarness({
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
  });
}

async function login(harness: Awaited<ReturnType<typeof createDashboardHarness>>) {
  const res = await harness.request("POST", "/auth/login", {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.status).toBe(200);
  const jar = cookieJar(res.setCookies);
  return { res, jar };
}

describe("auth routes", () => {
  test("GET /health is public and reports ok", async () => {
    const harness = await seededHarness();
    const res = await harness.request("GET", "/health");
    expect(res.status).toBe(200);
    expect(res.body?.status).toBe("ok");
  });

  test("login issues session + CSRF cookies with the right flags", async () => {
    const harness = await seededHarness();
    const { res, jar } = await login(harness);
    expect(res.body?.user?.email).toBe(ADMIN_EMAIL);
    expect(res.body?.user?.permissions).toContain("admin:access");
    expect(jar.mayarin_session).toBeDefined();
    expect(jar.mayarin_session?.startsWith("ses_")).toBe(true);
    expect(jar.mayarin_csrf).toBeDefined();

    const sessionCookie = res.setCookies.find((c) => c.startsWith("mayarin_session=")) ?? "";
    const csrfCookie = res.setCookies.find((c) => c.startsWith("mayarin_csrf=")) ?? "";
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Strict");
    expect(csrfCookie).toContain("SameSite=Strict");
    // CSRF cookie must be readable by browser JS, so it is NOT HttpOnly.
    expect(csrfCookie).not.toContain("HttpOnly");
  });

  test("login with a wrong password returns 401 with the constant message", async () => {
    const harness = await seededHarness();
    const res = await harness.request("POST", "/auth/login", {
      body: { email: ADMIN_EMAIL, password: "wrong" },
    });
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe("UNAUTHORIZED");
    expect(res.body?.error?.message).toBe("Invalid email or password");
  });

  test("GET /auth/me without a session returns user null", async () => {
    const harness = await seededHarness();
    const res = await harness.request("GET", "/auth/me");
    expect(res.status).toBe(200);
    expect(res.body?.user).toBeNull();
  });

  test("GET /auth/me with a session cookie returns the user", async () => {
    const harness = await seededHarness();
    const { jar } = await login(harness);
    const res = await harness.request("GET", "/auth/me", { cookies: jar });
    expect(res.status).toBe(200);
    expect(res.body?.user?.email).toBe(ADMIN_EMAIL);
  });

  test("logout without a session returns 401", async () => {
    const harness = await seededHarness();
    const res = await harness.request("POST", "/auth/logout");
    expect(res.status).toBe(401);
  });

  test("logout with a session but no CSRF token returns 403", async () => {
    const harness = await seededHarness();
    const { jar } = await login(harness);
    const res = await harness.request("POST", "/auth/logout", { cookies: jar });
    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("FORBIDDEN");
  });

  test("logout with a wrong CSRF token returns 403", async () => {
    const harness = await seededHarness();
    const { jar } = await login(harness);
    const res = await harness.request("POST", "/auth/logout", {
      cookies: jar,
      headers: { "x-csrf-token": "wrong" },
    });
    expect(res.status).toBe(403);
  });

  test("logout with the correct CSRF token clears the cookies", async () => {
    const harness = await seededHarness();
    const { jar } = await login(harness);
    const res = await harness.request("POST", "/auth/logout", {
      cookies: jar,
      headers: { "x-csrf-token": jar.mayarin_csrf ?? "" },
    });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
    for (const line of res.setCookies) {
      const { attrs } = parseSetCookie(line);
      expect(attrs).toContain("Max-Age=0");
    }
  });

  test("an expired session cookie is treated as no session on /auth/me", async () => {
    const harness = await seededHarness();
    const { jar } = await login(harness);
    // Advance the clock past the 1-hour TTL and re-issue a verify by hitting /me:
    // the session middleware drops the expired session, so /me reports no user.
    harness.clock.advance(2 * 60 * 60 * 1000);
    const res = await harness.request("GET", "/auth/me", { cookies: jar });
    expect(res.status).toBe(200);
    expect(res.body?.user).toBeNull();
  });
});
