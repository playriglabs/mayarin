/** Login history: every successful sign-in is listed, a failed one is not. */

import { describe, expect, test } from "bun:test";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const EMAIL = "admin@mayarin.local";
const PASSWORD = "correct-horse-battery-staple";

const seeded = () => createDashboardHarness({ adminEmail: EMAIL, adminPassword: PASSWORD });

describe("login history", () => {
  test("lists each sign-in, newest first, with the device", async () => {
    const harness = await seeded();
    await harness.request("POST", "/v1/auth/login", {
      body: { email: EMAIL, password: "wrong-password-entirely" },
    });
    await harness.request("POST", "/v1/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
      headers: { "user-agent": "first-browser" },
    });
    const res = await harness.request("POST", "/v1/auth/login", {
      body: { email: EMAIL, password: PASSWORD },
      headers: { "user-agent": "second-browser" },
    });
    const jar = cookieJar(res.setCookies);

    const history = await harness.request("GET", "/v1/auth/login-history", { cookies: jar });
    expect(history.status).toBe(200);
    const logins = history.body?.logins as { userAgent: string }[];
    expect(logins.map((login) => login.userAgent)).toEqual(["second-browser", "first-browser"]);
  });

  test("needs a session", async () => {
    const harness = await seeded();
    const res = await harness.request("GET", "/v1/auth/login-history");
    expect(res.status).toBe(401);
  });
});
