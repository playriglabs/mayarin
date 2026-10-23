import { describe, expect, test } from "bun:test";
import { createApiHarness } from "./harness.ts";

const TOKEN = "i".repeat(32);
const RAIL = { chain: "base", asset: "WBTC", settlementAsset: "USDT" };

describe("POST /v1/rails/priceable", () => {
  test("answers with the source checkout uses", async () => {
    const harness = createApiHarness({
      internalApiToken: TOKEN,
      priceable: (rail) => rail.asset !== "WBTC",
    });
    const headers = { "x-internal-token": TOKEN };

    const off = await harness.request("POST", "/v1/rails/priceable", { body: RAIL, headers });
    const on = await harness.request("POST", "/v1/rails/priceable", {
      body: { ...RAIL, asset: "WETH" },
      headers,
    });

    expect(off.body).toEqual({ priceable: false });
    expect(on.body).toEqual({ priceable: true });
  });

  test("is closed to anyone without the internal token", async () => {
    const harness = createApiHarness({ internalApiToken: TOKEN });

    const none = await harness.request("POST", "/v1/rails/priceable", { body: RAIL });
    const wrong = await harness.request("POST", "/v1/rails/priceable", {
      body: RAIL,
      headers: { "x-internal-token": "x".repeat(32) },
    });

    expect(none.status).toBe(401);
    expect(wrong.status).toBe(401);
  });

  test("refuses a body that names no chain", async () => {
    const harness = createApiHarness({ internalApiToken: TOKEN });

    const { status } = await harness.request("POST", "/v1/rails/priceable", {
      body: { asset: "WBTC", settlementAsset: "USDT" },
      headers: { "x-internal-token": TOKEN },
    });

    expect(status).toBe(400);
  });
});
