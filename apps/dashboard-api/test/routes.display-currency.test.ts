/** Display currency: chosen at signup or in settings, and the rate the dashboard converts with. */

import { describe, expect, test } from "bun:test";
import { DisplayRateService } from "../src/services/display-rate-service.ts";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const EMAIL = "admin@mayarin.local";
const PASSWORD = "correct-horse-battery-staple";

async function signedIn() {
  const harness = await createDashboardHarness({ adminEmail: EMAIL, adminPassword: PASSWORD });
  const login = await harness.request("POST", "/v1/auth/login", {
    body: { email: EMAIL, password: PASSWORD },
  });
  const jar = cookieJar(login.setCookies);
  return { harness, jar, headers: { "x-csrf-token": jar.mayarin_csrf ?? "" } };
}

describe("display currency", () => {
  test("the register form can list currencies before there is an account", async () => {
    const { harness } = await signedIn();
    const res = await harness.request("GET", "/v1/fx/currencies");
    expect(res.status).toBe(200);
    expect(res.body?.currencies).toEqual(["EUR", "IDR", "JPY", "USD"]);
  });

  test("a merchant starts in dollars and analytics says one dollar is one dollar", async () => {
    const { harness, jar } = await signedIn();
    const res = await harness.request("GET", "/v1/analytics", { cookies: jar });
    expect(res.body?.display).toEqual({ currency: "USD", perUsd: "1" });
  });

  test("a chosen currency comes back with its rate", async () => {
    const { harness, jar, headers } = await signedIn();
    const saved = await harness.request("PATCH", "/v1/settings", {
      body: { displayCurrency: "idr" },
      cookies: jar,
      headers,
    });
    expect(saved.status).toBe(200);
    expect(saved.body?.settings.displayCurrency).toBe("IDR");

    const res = await harness.request("GET", "/v1/analytics", { cookies: jar });
    expect(res.body?.display).toEqual({ currency: "IDR", perUsd: "16000.00000000" });
  });

  test("refuses a currency the table does not quote", async () => {
    const { harness, jar, headers } = await signedIn();
    const res = await harness.request("PATCH", "/v1/settings", {
      body: { displayCurrency: "ZZZ" },
      cookies: jar,
      headers,
    });
    expect(res.status).toBe(400);
  });
});

describe("DisplayRateService", () => {
  const clock = {
    time: new Date("2026-01-01T00:00:00Z"),
    now() {
      return this.time;
    },
  };

  test("fetches once per ttl, however many merchants ask", async () => {
    let calls = 0;
    const service = new DisplayRateService({
      url: "http://rates.test",
      ttlSeconds: 60,
      clock,
      fetch: async () => {
        calls += 1;
        return Response.json({ rates: { USD: 1, IDR: 16_000 } });
      },
    });
    await Promise.all([service.perUsd("IDR"), service.perUsd("IDR"), service.perUsd("USD")]);
    await service.perUsd("IDR");
    expect(calls).toBe(1);

    clock.time = new Date(clock.time.getTime() + 61_000);
    await service.perUsd("IDR");
    expect(calls).toBe(2);
  });

  test("keeps serving the last table when the source fails, and does not hammer it", async () => {
    let calls = 0;
    let down = false;
    const service = new DisplayRateService({
      url: "http://rates.test",
      ttlSeconds: 60,
      clock,
      fetch: async () => {
        calls += 1;
        if (down) throw new Error("offline");
        return Response.json({ rates: { USD: 1, IDR: 16_000 } });
      },
    });
    await service.perUsd("IDR");
    down = true;
    clock.time = new Date(clock.time.getTime() + 61_000);
    expect(await service.perUsd("IDR")).toBe("16000.00000000");
    await service.perUsd("IDR");
    await service.perUsd("IDR");
    expect(calls).toBe(2);
  });
});
