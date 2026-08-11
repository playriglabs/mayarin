import { describe, expect, test } from "bun:test";
import { cookieJar, createDashboardHarness } from "./harness.ts";

const ADMIN_EMAIL = "admin@mayarin.local";
const ADMIN_PASSWORD = "correct-horse-battery-staple";

describe("GET /analytics", () => {
  test("returns the complete merchant dataset without pagination", async () => {
    const harness = await createDashboardHarness({
      adminEmail: ADMIN_EMAIL,
      adminPassword: ADMIN_PASSWORD,
    });
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        harness.intentService.create({
          merchant: {
            id: harness.merchantId,
            name: "Warung",
            city: "Jakarta",
            countryCode: "ID",
          },
          amount: { amount: BigInt(index + 1), asset: "IDR" },
          source: { type: "manual" },
        }),
      ),
    );
    await harness.intentService.create({
      merchant: { id: "mch_other", name: "Other", city: "Bandung", countryCode: "ID" },
      amount: { amount: 99n, asset: "IDR" },
      source: { type: "manual" },
    });
    const login = await harness.request("POST", "/v1/auth/login", {
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    const response = await harness.request("GET", "/v1/analytics?limit=1&cursor=ignored", {
      cookies: cookieJar(login.setCookies),
    });

    expect(response.status).toBe(200);
    expect(response.body?.payments).toHaveLength(8);
    expect(response.body?.settlements).toEqual([]);
    expect(
      response.body?.payments.every(
        (payment: { merchant: { id: string } }) => payment.merchant.id === harness.merchantId,
      ),
    ).toBe(true);
  });
});
