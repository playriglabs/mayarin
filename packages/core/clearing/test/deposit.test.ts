import { describe, expect, test } from "bun:test";
import { money } from "@mayarin/shared";
import { createHarness } from "./harness.ts";

const IDRX = (minorUnits: bigint) => money(minorUnits, "IDRX");

describe("deposit leg", () => {
  test("an intent with no rail locks the price exactly as before", async () => {
    const harness = createHarness();
    const intent = await harness.confirmedIntent();
    const transaction = await harness.engine.start(intent);

    expect(transaction.deposit).toBeUndefined();
    expect(transaction.state).toBe("SUCCESS");
  });

  test("an intent with a rail locks a deposit amount and an address", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      // 50,000.00 IDR at 320 minor USDC units per whole IDR is 16.000000 USDC.
      rates: { "IDR/IDRX": 100n, "IDR/USDC": 320n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("PAYMENT_PENDING");
    expect(transaction.deposit?.asset).toBe("USDC");
    expect(transaction.deposit?.chain).toBe("base-sepolia");
    expect(transaction.deposit?.amount.amount).toBe(16_000_000n);
    expect(transaction.deposit?.address).toBe("0x".concat("0".repeat(40)));
  });

  test("the settlement leg is unaffected by the deposit leg", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/IDRX": 100n, "IDR/USDC": 320n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
    });

    const transaction = await harness.engine.start(intent);

    // 50,000.00 IDR -> 50,000.00 IDRX, 0.50% fee.
    expect(transaction.settlementAmount?.amount).toBe(5_000_000n);
    expect(transaction.fee?.amount).toBe(25_000n);
    expect(transaction.netAmount?.amount).toBe(4_975_000n);
  });

  test("replaying the price lock reuses the same address", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/IDRX": 100n, "IDR/USDC": 320n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
    });

    const first = await harness.engine.start(intent);
    const again = await harness.engine.resume(first.id);

    expect(again.transaction.deposit?.address).toBe(first.deposit?.address ?? "");
  });

  test("a rail with no configured rate fails the transaction", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/IDRX": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("FAILED");
    expect(transaction.failure?.code).toBe("CONFIGURATION_ERROR");
  });

  test("the on-chain-contract path without a planner fails before moving value", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/IDRX": 100n, "IDR/USDC": 320n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "on-chain-contract",
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("FAILED");
    expect(transaction.failure?.code).toBe("CONFIGURATION_ERROR");
    expect(transaction.failure?.reason).toContain("no contract planner");
    // No deposit address allocated, no value posted.
    expect(transaction.deposit).toBeUndefined();
    expect(await harness.balance("TREASURY")).toEqual(IDRX(0n));
  });
});
