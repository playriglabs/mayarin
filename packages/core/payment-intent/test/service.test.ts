import { describe, expect, test } from "bun:test";
import { FixedClock, money, ValidationError } from "@mayarin/shared";
import { InMemoryStablecoinRegistry } from "@mayarin/stablecoin";
import { PaymentIntentService } from "../src/service.ts";
import type { PaymentRail } from "../src/types.ts";
import { InMemoryPaymentIntentRepository } from "../testing/index.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function service(admitted: ReturnType<typeof registry>) {
  return new PaymentIntentService({
    repository: new InMemoryPaymentIntentRepository(),
    clock: new FixedClock(NOW),
    defaults: {
      settlementAsset: "IDRX",
      provider: "mock",
      executionPath: "deposit-match",
      ttlSeconds: 900,
    },
    registry: new InMemoryStablecoinRegistry(admitted),
  });
}

function registry() {
  return [
    { asset: "IDRX" as const, onChain: [] },
    {
      asset: "USDC",
      onChain: [{ chain: "base-sepolia", address: "0xusdc" }],
    },
  ] as const;
}

const merchant = { id: "M-1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };

describe("PaymentIntentService admissibility", () => {
  test("accepts an admitted settlement asset", async () => {
    const intent = await service(registry()).create({
      merchant,
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" },
      settlementAsset: "IDRX",
    });
    expect(intent.settlementAsset).toBe("IDRX");
  });

  test("rejects a settlement asset the registry does not admit", async () => {
    await expect(
      service(registry()).create({
        merchant,
        amount: money(5_000_000n, "IDR"),
        source: { type: "manual" },
        settlementAsset: "USDT",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("accepts a payer leg on a chain where the asset is deployed", async () => {
    const payment: PaymentRail = { asset: "USDC", chain: "base-sepolia" };
    const intent = await service(registry()).create({
      merchant,
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" },
      payment,
    });
    expect(intent.payment).toEqual(payment);
  });

  test("rejects a payer leg on a chain where the asset is not deployed", async () => {
    await expect(
      service(registry()).create({
        merchant,
        amount: money(5_000_000n, "IDR"),
        source: { type: "manual" },
        payment: { asset: "USDC", chain: "base" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("rejects a ledger-only asset as the payer leg", async () => {
    await expect(
      service(registry()).create({
        merchant,
        amount: money(5_000_000n, "IDR"),
        source: { type: "manual" },
        payment: { asset: "IDRX", chain: "base-sepolia" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("skips admissibility when no registry is injected", async () => {
    const intents = new PaymentIntentService({
      repository: new InMemoryPaymentIntentRepository(),
      clock: new FixedClock(NOW),
      defaults: {
        settlementAsset: "IDRX",
        provider: "mock",
        executionPath: "deposit-match",
        ttlSeconds: 900,
      },
    });
    const intent = await intents.create({
      merchant,
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" },
      settlementAsset: "IDRX",
    });
    expect(intent.settlementAsset).toBe("IDRX");
  });
});

describe("PaymentIntentService execution path", () => {
  const rail: PaymentRail = { asset: "USDC", chain: "base-sepolia" };

  test("defaults to deposit-match for an intent that names a payment rail", async () => {
    const intent = await service(registry()).create({
      merchant,
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" },
      payment: rail,
    });
    expect(intent.executionPath).toBe("deposit-match");
  });

  test("carries no execution path for a fiat-only intent", async () => {
    const intent = await service(registry()).create({
      merchant,
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" },
      settlementAsset: "IDRX",
    });
    expect(intent.executionPath).toBeUndefined();
  });

  test("accepts the on-chain-contract path for an admitted rail", async () => {
    const intent = await service(registry()).create({
      merchant,
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" },
      payment: rail,
      executionPath: "on-chain-contract",
    });
    expect(intent.executionPath).toBe("on-chain-contract");
  });

  test("rejects the on-chain-contract path without a payment rail", async () => {
    await expect(
      service(registry()).create({
        merchant,
        amount: money(5_000_000n, "IDR"),
        source: { type: "manual" },
        executionPath: "on-chain-contract",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("distinguishes intents that differ only by execution path", async () => {
    const base = {
      merchant,
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" as const },
      payment: rail,
    };
    const deposit = await service(registry()).create(base);
    const contract = await service(registry()).create({
      ...base,
      executionPath: "on-chain-contract",
    });
    expect(deposit.requestFingerprint).not.toBe(contract.requestFingerprint);
  });
});
