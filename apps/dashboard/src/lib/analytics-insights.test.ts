import { describe, expect, test } from "bun:test";
import { payerAssetBreakdown, payerCountryBreakdown } from "@/lib/analytics-insights";
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
    amount: { asset: "CNY", amount: "714", formatted: "7.14", display: "CN¥ 7.14" },
    settlementAsset: "USDC",
    provider: "stablecoin",
    payment: { asset: "USDC", chain: "base-sepolia" },
    escrow: null,
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

describe("analytics insights", () => {
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

  test("folds everything past the fourth rank into Others", () => {
    const assets = ["USDC", "USDC", "USDC", "ETH", "ETH", "EURC", "DAI", "WBTC", "USDT"];
    const rows = assets.map((asset, index) =>
      payment(`p${index}`, "2026-09-10T00:00:00.000Z", {
        payment: { asset, chain: "base-sepolia" },
        metadata: { payerCountryCode: ["ID", "SG", "MY", "TH", "VN", "PH"][index % 6] ?? "ID" },
      }),
    );
    expect(payerAssetBreakdown(rows).map(({ key, count }) => [key, count])).toEqual([
      ["USDC", 3],
      ["ETH", 2],
      ["DAI", 1],
      ["EURC", 1],
      ["Others", 2],
    ]);
    const countries = payerCountryBreakdown(rows);
    expect(countries).toHaveLength(5);
    expect(countries.at(-1)?.key).toBe("Others");
    expect(countries.reduce((sum, row) => sum + row.count, 0)).toBe(assets.length);
  });
});
