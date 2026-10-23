import { describe, expect, test } from "bun:test";
import { createApiHarness } from "./harness.ts";

const admin = { auth: false as const, headers: { Authorization: "Bearer admin-token-1234567890" } };

describe("merchant terms", () => {
  test("an edit keeps what the body leaves out", async () => {
    const harness = createApiHarness({ adminToken: "admin-token-1234567890" });

    const before = await harness.request("GET", "/v1/admin/merchants/merchant-1/terms", admin);
    const updated = await harness.request("PUT", "/v1/admin/merchants/merchant-1/terms", {
      ...admin,
      body: { feeBasisPoints: 25 },
    });

    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ ...before.body, feeBasisPoints: 25 });
  });

  test("a bad fee or limit is refused and nothing is stored", async () => {
    const harness = createApiHarness({ adminToken: "admin-token-1234567890" });
    const before = await harness.request("GET", "/v1/admin/merchants/merchant-1/terms", admin);

    for (const body of [
      { feeBasisPoints: 10_001 },
      { feeMinimum: "0.123" },
      { maxPaymentSettlement: "0" },
      { maxDailySettlement: "lots" },
    ]) {
      const response = await harness.request("PUT", "/v1/admin/merchants/merchant-1/terms", {
        ...admin,
        body,
      });
      expect(response.status).toBe(400);
    }

    const after = await harness.request("GET", "/v1/admin/merchants/merchant-1/terms", admin);
    expect(after.body).toEqual(before.body);
  });

  test("is behind the admin token", async () => {
    const harness = createApiHarness({ adminToken: "admin-token-1234567890" });
    const response = await harness.request("GET", "/v1/admin/merchants/merchant-1/terms", {
      auth: false,
    });
    expect(response.status).toBe(401);
  });
});
