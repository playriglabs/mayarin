import { describe, expect, test } from "bun:test";
import {
  payerAssetBreakdown,
  payerCountryBreakdown,
  paymentsIn,
  reportingPeriods,
  summarizePeriod,
} from "@/lib/analytics-insights";
import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

function payment(
  id: string,
  createdAt: string,
  overrides: Partial<PaymentIntentDto> = {},
): PaymentIntentDto {
  return {
    id,
    status: "COMPLETED",
    merchant: { id: "mch_1", name: "Merchant", city: "Jakarta", countryCode: "ID" },
    amount: { asset: "CNY", amount: "714", formatted: "7.14", display: "CN¥ 7.14" },
    settlementAsset: "USDC",
    provider: "stablecoin",
    payment: { asset: "USDC", chain: "base-sepolia" },
    source: { type: "manual" },
    merchantReference: null,
    metadata: { payerCountryCode: "ID" },
    clearingTransactionId: `clr_${id}`,
    failureReason: null,
    createdAt,
    expiresAt: createdAt,
    confirmedAt: createdAt,
    completedAt: new Date(new Date(createdAt).getTime() + 60_000).toISOString(),
    ...overrides,
  };
}

function settlement(id: string, amount = "1000000"): SettlementDto {
  const value = { asset: "USDC", amount, formatted: amount, display: amount };
  return {
    paymentIntentId: id,
    clearingTransactionId: `clr_${id}`,
    state: "SUCCESS",
    sourceAmount: value,
    settlementAsset: "USDC",
    settlementAmount: value,
    fee: null,
    netAmount: value,
    destination: null,
    reference: null,
    provider: "stablecoin",
    executionPath: null,
    onChain: null,
    payment: null,
    chain: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:01:00.000Z",
    expiresAt: "2026-09-10T01:00:00.000Z",
    completedAt: "2026-09-10T00:01:00.000Z",
  };
}

describe("analytics reporting periods", () => {
  test("builds adjacent thirty-day UTC windows and excludes the boundary", () => {
    const periods = reportingPeriods(new Date("2026-09-10T12:00:00.000Z"));
    const rows = [
      payment("previous", "2026-08-11T23:59:59.999Z"),
      payment("current", "2026-08-12T00:00:00.000Z"),
      payment("today", "2026-09-10T23:59:59.999Z"),
    ];
    expect(paymentsIn(rows, periods.current).map((row) => row.id)).toEqual(["current", "today"]);
    expect(paymentsIn(rows, periods.previous).map((row) => row.id)).toEqual(["previous"]);
  });
});

describe("analytics insights", () => {
  test("summarizes normalized gross volume, conversion, average and timing", () => {
    const completed = payment("paid", "2026-09-10T00:00:00.000Z");
    const failed = payment("failed", "2026-09-10T00:00:00.000Z", {
      status: "FAILED",
      completedAt: null,
    });
    const insight = summarizePeriod([completed, failed], [settlement("paid")]);
    expect(insight).toEqual({
      paymentCount: 2,
      completedCount: 1,
      grossUsd: 100n,
      averageUsd: 100n,
      conversionRate: 0.5,
      completion: { count: 1, medianSeconds: 60, p95Seconds: 60 },
    });
  });

  test("ranks payer asset and country from completed payments", () => {
    const rows = [
      payment("one", "2026-09-10T00:00:00.000Z"),
      payment("two", "2026-09-10T00:00:00.000Z"),
      payment("three", "2026-09-10T00:00:00.000Z", {
        payment: { asset: "ETH", chain: "ethereum-sepolia" },
        metadata: {},
      }),
    ];
    expect(payerAssetBreakdown(rows).map(({ key, count }) => [key, count])).toEqual([
      ["USDC", 2],
      ["ETH", 1],
    ]);
    expect(payerCountryBreakdown(rows).map(({ key, count }) => [key, count])).toEqual([
      ["ID", 2],
      ["Unknown", 1],
    ]);
  });
});
