import { describe, expect, test } from "bun:test";
import { createApiHarness, TEST_MERCHANT_ID } from "./harness.ts";

describe("GET /v1/risk/flags", () => {
  test("lists this merchant's flagged payments and no one else's", async () => {
    const harness = createApiHarness();
    const base = { payer: undefined, assessedAt: new Date("2026-10-19T00:00:00.000Z") };
    harness.flagged.push(
      {
        ...base,
        id: "rsk_1",
        paymentIntentId: "pi_1",
        merchantId: TEST_MERCHANT_ID,
        outcome: "REVIEW",
        signals: [{ rule: "merchant-velocity", action: "review", detail: "9 payments" }],
      },
      {
        ...base,
        id: "rsk_2",
        paymentIntentId: "pi_2",
        merchantId: "mrc_other",
        outcome: "BLOCKED",
        signals: [],
      },
    );

    const { status, body } = await harness.request("GET", "/v1/risk/flags");
    expect(status).toBe(200);
    expect(body.flags).toEqual([
      {
        id: "rsk_1",
        paymentIntentId: "pi_1",
        outcome: "REVIEW",
        payer: null,
        signals: [{ rule: "merchant-velocity", detail: "9 payments" }],
        assessedAt: "2026-10-19T00:00:00.000Z",
      },
    ]);
  });

  test("needs a key with payments:read", async () => {
    const harness = createApiHarness();
    const key = harness.mintApiKey(TEST_MERCHANT_ID, "mak_test_nope", ["catalog:manage"]);
    expect((await harness.request("GET", "/v1/risk/flags", { auth: key })).status).toBe(403);
    expect((await harness.request("GET", "/v1/risk/flags", { auth: false })).status).toBe(401);
  });
});
