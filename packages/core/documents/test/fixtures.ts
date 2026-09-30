import type { ClearingTransaction } from "@mayarin/clearing";
import type { PaymentIntent } from "@mayarin/payment-intent";
import { money } from "@mayarin/shared";

export const CREATED = new Date("2026-09-23T10:00:00.000Z");
export const COMPLETED = new Date("2026-09-23T10:05:00.000Z");
export const HASH = `0x${"ab".repeat(32)}`;

export const merchant = { id: "mrc_1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };

export function intent(overrides: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: "pi_01J8ZQ4T5E7V9XK2M3N4P5Q6R7",
    status: "COMPLETED",
    merchant,
    amount: money(5_000_000n, "IDR"),
    settlementAsset: "USDC",
    provider: "mock",
    payment: { asset: "USDC", chain: "arbitrum-sepolia" },
    executionPath: "deposit-match",
    source: { type: "manual" },
    metadata: {},
    createdAt: CREATED,
    updatedAt: COMPLETED,
    expiresAt: new Date("2026-09-23T10:15:00.000Z"),
    completedAt: COMPLETED,
    version: 4,
    ...overrides,
  };
}

export function transaction(overrides: Partial<ClearingTransaction> = {}): ClearingTransaction {
  const rate = {
    from: "IDR" as const,
    to: "USDC" as const,
    scaledRate: 60n,
    source: "coinbase",
    lockedAt: CREATED,
  };
  return {
    id: "clr_01J8ZQ4T5E7V9XK2M3N4PABCD9",
    paymentIntentId: "pi_01J8ZQ4T5E7V9XK2M3N4P5Q6R7",
    state: "SUCCESS",
    merchant: { id: "mrc_1", name: "Warung Kopi" } as ClearingTransaction["merchant"],
    sourceAmount: money(5_000_000n, "IDR"),
    settlementAsset: "USDC",
    provider: "mock",
    executionPath: "deposit-match",
    rate,
    settlementAmount: money(3_000_000n, "USDC"),
    fee: money(30_000n, "USDC"),
    netAmount: money(2_970_000n, "USDC"),
    deposit: {
      asset: "USDC",
      chain: "arbitrum-sepolia",
      address: `0x${"11".repeat(20)}`,
      amount: money(3_000_000n, "USDC"),
      rate,
    },
    createdAt: CREATED,
    updatedAt: COMPLETED,
    version: 8,
    ...overrides,
  };
}
