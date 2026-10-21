import { describe, expect, test } from "bun:test";
import { createMayarin } from "../src/index.ts";

function clientReturning(responseBody: unknown) {
  const urls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return {
    urls,
    client: createMayarin({ baseUrl: "https://api.test", secretKey: "sk_test", fetch }),
  };
}

describe("analytics module", () => {
  test("get sends the range, filters and metrics as a query", async () => {
    const { client, urls } = clientReturning({ currency: "USD", metrics: [] });
    const report = await client.analytics.get({
      from: "2026-10-01",
      to: "2026-10-07",
      interval: "week",
      chain: "base-sepolia",
      asset: "USDC",
      metrics: ["revenue", "success_rate"],
    });

    expect(report.currency).toBe("USD");
    const url = new URL(urls[0] ?? "");
    expect(url.pathname).toBe("/v1/analytics");
    expect(url.searchParams.get("from")).toBe("2026-10-01");
    expect(url.searchParams.get("to")).toBe("2026-10-07");
    expect(url.searchParams.get("interval")).toBe("week");
    expect(url.searchParams.get("chain")).toBe("base-sepolia");
    expect(url.searchParams.get("asset")).toBe("USDC");
    expect(url.searchParams.get("metrics")).toBe("revenue,success_rate");
  });

  test("get with no options sends no query", async () => {
    const { client, urls } = clientReturning({ currency: "USD", metrics: [] });
    await client.analytics.get();
    expect(new URL(urls[0] ?? "").search).toBe("");
  });
});
