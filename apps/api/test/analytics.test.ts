import { describe, expect, test } from "bun:test";
import type { ClearingTransaction } from "@mayarin/clearing";
import type { PaymentIntent } from "@mayarin/payment-intent";
import { analyticsQuerySchema } from "../src/dto/analytics.ts";
import { buildAnalytics } from "../src/services/analytics.ts";
import { createApiHarness } from "./harness.ts";

const NOW = new Date("2026-10-07T12:00:00Z");
const at = (day: number, seconds = 0) => new Date(Date.UTC(2026, 9, day, 10, 0, seconds));

function intent(
  id: string,
  createdAt: Date,
  overrides: Partial<PaymentIntent> & { seconds?: number; unfinished?: true } = {},
): PaymentIntent {
  const { seconds = 60, unfinished, ...rest } = overrides;
  return {
    id,
    status: "COMPLETED",
    amount: { asset: "USD", amount: 1000n },
    payment: { asset: "USDC", chain: "base-sepolia" },
    metadata: {},
    createdAt,
    ...(unfinished === true ? {} : { completedAt: new Date(createdAt.getTime() + seconds * 1000) }),
    ...rest,
  } as PaymentIntent;
}

const query = (overrides = {}) =>
  analyticsQuerySchema.parse({ from: "2026-10-01", to: "2026-10-07", ...overrides });

const metric = (report: ReturnType<typeof buildAnalytics>, key: string) =>
  report.metrics.find((entry) => entry.key === key);

describe("buildAnalytics", () => {
  const payments = [
    intent("a", at(2), { seconds: 10 }),
    intent("b", at(2), { seconds: 30 }),
    intent("c", at(3), { status: "FAILED", unfinished: true }),
    intent("d", at(3), { status: "CREATED", unfinished: true }),
  ];
  const report = buildAnalytics({ payments, clearing: [], query: query(), now: NOW });

  test("revenue sums completed payments per day and zero-fills the rest", () => {
    expect(metric(report, "revenue")?.points.map((point) => point.value)).toEqual([
      0, 2000, 0, 0, 0, 0, 0,
    ]);
    expect(metric(report, "revenue")?.total).toBe(2000);
  });

  test("conversion counts every checkout, success rate only those that finished", () => {
    expect(metric(report, "conversion_rate")?.total).toBeCloseTo(2 / 4);
    expect(metric(report, "success_rate")?.total).toBeCloseTo(2 / 3);
  });

  test("time to pay is the median, p90 the wait nine in ten stayed under", () => {
    expect(metric(report, "time_to_pay")?.total).toBe(20);
    expect(metric(report, "time_to_pay_p90")?.total).toBe(30);
  });

  test("a rate with nothing behind it is null, not zero", () => {
    const empty = buildAnalytics({ payments: [], clearing: [], query: query(), now: NOW });
    expect(metric(empty, "conversion_rate")?.total).toBeNull();
    expect(metric(empty, "time_to_pay")?.points[0]?.value).toBeNull();
  });

  test("change compares against the range of the same length before", () => {
    const withPrevious = buildAnalytics({
      payments: [...payments, intent("p", new Date(Date.UTC(2026, 8, 28, 10)))],
      clearing: [],
      query: query(),
      now: NOW,
    });
    // $20 this week against $10 the week before.
    expect(metric(withPrevious, "revenue")?.change).toBe(100);
  });

  test("net revenue and fees come from settled dollar settlements only", () => {
    const tx = {
      paymentIntentId: "a",
      state: "SETTLED",
      createdAt: at(2),
      updatedAt: at(2, 20),
      netAmount: { asset: "USDC", amount: 9_900_000n },
      fee: { asset: "USDC", amount: 100_000n },
    } as ClearingTransaction;
    const settled = buildAnalytics({ payments, clearing: [tx], query: query(), now: NOW });
    expect(metric(settled, "net_revenue")?.total).toBe(990);
    expect(metric(settled, "fees")?.total).toBe(10);
    expect(metric(settled, "settlements")?.total).toBe(1);
  });

  test("breakdowns and performance group by network and payer asset", () => {
    expect(report.breakdowns.networks).toEqual([{ key: "base-sepolia", count: 2, share: 1 }]);
    expect(report.performance.networks).toEqual([
      { key: "base-sepolia", finished: 3, successRate: 2 / 3, medianSeconds: 20 },
    ]);
  });

  test("a network filter keeps only payments on it", () => {
    const other = buildAnalytics({
      payments,
      clearing: [],
      query: query({ chain: "arc-testnet" }),
      now: NOW,
    });
    expect(metric(other, "orders")?.total).toBe(0);
  });

  test("metrics narrows the response to the keys asked for", () => {
    const some = buildAnalytics({
      payments,
      clearing: [],
      query: query({ metrics: "orders, success_rate" }),
      now: NOW,
    });
    expect(some.metrics.map((entry) => entry.key)).toEqual(["orders", "success_rate"]);
  });
});

describe("GET /v1/analytics", () => {
  test("answers with every metric for the key's merchant", async () => {
    const harness = createApiHarness();
    const { status, body } = await harness.request("GET", "/v1/analytics");
    expect(status).toBe(200);
    expect(body.currency).toBe("USD");
    expect(body.metrics).toHaveLength(14);
  });

  test("refuses an unknown metric and an overlong range", async () => {
    const harness = createApiHarness();
    expect((await harness.request("GET", "/v1/analytics?metrics=nope")).status).toBe(400);
    expect(
      (await harness.request("GET", "/v1/analytics?from=2024-01-01&to=2026-01-01")).status,
    ).toBe(400);
  });
});
