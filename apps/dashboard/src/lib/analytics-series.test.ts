import { describe, expect, test } from "bun:test";
import {
  bucketOf,
  bucketsOf,
  filterPayments,
  metricsOf,
  ORDERS,
  previousRange,
  REVENUE,
} from "@/lib/analytics-series";
import type { PaymentIntentDto } from "@/types/payment";

function payment(
  id: string,
  createdAt: string,
  overrides: Partial<PaymentIntentDto> = {},
): PaymentIntentDto {
  return {
    id,
    status: "COMPLETED",
    merchant: { id: "mch_1", name: "Merchant", city: "Jakarta", countryCode: "ID" },
    amount: { asset: "USD", amount: "1000", formatted: "10.00", display: "$ 10" },
    settlementAsset: "USDC",
    provider: "stablecoin",
    payment: { asset: "USDC", chain: "base-sepolia" },
    escrow: null,
    source: { type: "manual" },
    merchantReference: null,
    metadata: {},
    clearingTransactionId: `clr_${id}`,
    failureReason: null,
    createdAt,
    expiresAt: createdAt,
    confirmedAt: createdAt,
    completedAt: new Date(new Date(createdAt).getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

const RANGE = { from: "2026-10-01", to: "2026-10-07" };

describe("bucketing", () => {
  test("every day in the range is a bucket, including the empty ones", () => {
    expect(bucketsOf(RANGE, "day")).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
  });

  test("weeks start on Monday and months on the first", () => {
    // 2026-10-01 is a Thursday.
    expect(bucketOf("2026-10-01", "week")).toBe("2026-09-28");
    expect(bucketsOf(RANGE, "week")).toEqual(["2026-09-28", "2026-10-05"]);
    expect(bucketsOf({ from: "2026-08-20", to: "2026-10-07" }, "month")).toEqual([
      "2026-08-01",
      "2026-09-01",
      "2026-10-01",
    ]);
  });

  test("the previous range is the same length, ending the day before", () => {
    expect(previousRange(RANGE)).toEqual({ from: "2026-09-24", to: "2026-09-30" });
  });
});

describe("metrics", () => {
  const payments = [
    payment("a", "2026-10-02T10:00:00.000Z"),
    payment("b", "2026-10-02T11:00:00.000Z"),
    payment("c", "2026-10-05T09:00:00.000Z", { status: "EXPIRED", completedAt: null }),
    payment("d", "2026-09-26T09:00:00.000Z"),
  ];
  const input = { payments, settlements: [], range: RANGE, interval: "day" as const, rates: {} };

  test("revenue sums completed payments per day, and zero-fills the rest", () => {
    const [revenue] = metricsOf(REVENUE, input);
    expect(revenue?.points.map((point) => point.value)).toEqual([0, 20, 0, 0, 0, 0, 0]);
    // $20 this week against $10 the week before.
    expect(revenue?.change).toBe(100);
  });

  test("cumulative revenue is a running sum ending at the range's revenue", () => {
    const cumulative = metricsOf(REVENUE, { ...input, cumulative: true }).find(
      (metric) => metric.key === "cumulative-revenue",
    );
    expect(cumulative?.points.map((point) => point.value)).toEqual([0, 20, 20, 20, 20, 20, 20]);
  });

  test("conversion counts every checkout, paid or not", () => {
    const conversion = metricsOf(ORDERS, input).find((metric) => metric.key === "conversion");
    expect(conversion?.total).toBe("66.7%");
  });

  test("a network filter keeps only payments on that network", () => {
    const filtered = filterPayments(
      [payment("a", RANGE.from), payment("b", RANGE.from, { payment: null })],
      { chain: "base-sepolia" },
    );
    expect(filtered.map((row) => row.id)).toEqual(["a"]);
  });
});
