import { describe, expect, test } from "bun:test";
import { payInAmountUsd } from "@/lib/analytics-movements";
import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

function payment(
  id: string,
  asset: string,
  amount: string,
  status: PaymentIntentDto["status"] = "COMPLETED",
): PaymentIntentDto {
  return {
    id,
    status,
    merchant: { id: "mch_1", name: "Merchant", city: "Jakarta", countryCode: "ID" },
    amount: { asset, amount, formatted: amount, display: amount },
    settlementAsset: "USDC",
    provider: "stablecoin",
    payment: null,
    source: { type: "manual" },
    merchantReference: null,
    metadata: {},
    clearingTransactionId: `clr_${id}`,
    failureReason: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    expiresAt: "2026-09-10T01:00:00.000Z",
    confirmedAt: "2026-09-10T00:01:00.000Z",
    completedAt: "2026-09-10T00:02:00.000Z",
  };
}

function settlement(paymentIntentId: string, amount: string, asset = "USDC"): SettlementDto {
  const money = { asset, amount, formatted: amount, display: amount };
  return {
    paymentIntentId,
    clearingTransactionId: `clr_${paymentIntentId}`,
    state: "SUCCESS",
    sourceAmount: money,
    settlementAsset: asset,
    settlementAmount: money,
    fee: null,
    netAmount: money,
    destination: null,
    reference: null,
    provider: "stablecoin",
    executionPath: null,
    onChain: null,
    payment: null,
    chain: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:02:00.000Z",
    expiresAt: "2026-09-10T01:00:00.000Z",
    completedAt: "2026-09-10T00:02:00.000Z",
  };
}

describe("payInAmountUsd", () => {
  test("keeps a USD-priced payment in exact USD minor units", () => {
    expect(payInAmountUsd(payment("pi_usd", "USD", "125"), undefined)).toBe(125n);
  });

  test("uses the locked gross USDC amount for a non-USD payment", () => {
    expect(payInAmountUsd(payment("pi_cny", "CNY", "714"), settlement("pi_cny", "1000000"))).toBe(
      100n,
    );
  });

  test("rounds the six-decimal settlement amount to USD cents", () => {
    expect(payInAmountUsd(payment("pi_eur", "EUR", "100"), settlement("pi_eur", "1235000"))).toBe(
      124n,
    );
  });

  test("does not invent a USD value without a completed dollar settlement", () => {
    expect(payInAmountUsd(payment("pi_pending", "CNY", "714", "PROCESSING"), undefined)).toBeNull();
    expect(
      payInAmountUsd(payment("pi_eurc", "CNY", "714"), settlement("pi_eurc", "1000000", "EURC")),
    ).toBeNull();
  });
});
