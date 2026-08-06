import { describe, expect, test } from "bun:test";
import { money } from "@mayarin/shared";
import type { ContractLock } from "../src/contract-path.ts";
import { FakeContractPlanner } from "../testing/index.ts";
import { createHarness, NOW } from "./harness.ts";

const TX_HASH = `0x${"77".repeat(32)}`;
const LOCK_TTL_MS = 120_000;

/** A lock the planner would produce for the harness's 50,000.00 IDR intent. */
function contractLock(overrides: Partial<ContractLock> = {}): ContractLock {
  const lockedAt = new Date(NOW);
  const expiresAt = new Date(lockedAt.getTime() + LOCK_TTL_MS);
  return {
    settlementAmount: money(5_000_000n, "IDRX"),
    fee: money(25_000n, "IDRX"),
    rate: {
      from: "ETH",
      to: "IDRX",
      minorUnitsPerWholeUnit: 60_000_000_00n,
      source: "0x",
      lockedAt,
    },
    payerEstimate: money(8_400_000_000_000_000n, "ETH"),
    expiresAt,
    order: {
      intentId: `0x${"11".repeat(32)}`,
      minOut: 5_000_000n,
      fee: 25_000n,
      deadline: BigInt(Math.floor(expiresAt.getTime() / 1_000)),
      signature: `0x${"ab".repeat(65)}`,
      signer: "0x00000000000000000000000000000000000000a1",
    },
    ...overrides,
  };
}

function contractHarness(options: Parameters<typeof createHarness>[0] = {}) {
  const planner = new FakeContractPlanner(contractLock());
  const harness = createHarness({ contractPlanner: planner, ...options });

  async function contractIntent() {
    return harness.confirmedIntent({
      payment: { asset: "ETH", chain: "base" },
      executionPath: "on-chain-contract",
    });
  }

  return { ...harness, planner, contractIntent };
}

const IDRX = (amount: bigint) => money(amount, "IDRX");

describe("contract path: lock", () => {
  test("locks through the planner and waits — auto-confirm never applies", async () => {
    const harness = contractHarness({ autoConfirmAssetReceipt: true });
    const intent = await harness.contractIntent();

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("PAYMENT_PENDING");
    expect(transaction.settlementAmount).toEqual(IDRX(5_000_000n));
    expect(transaction.fee).toEqual(IDRX(25_000n));
    expect(transaction.netAmount).toEqual(IDRX(4_975_000n));
    expect(transaction.rate?.source).toBe("0x");
    expect(transaction.deposit).toBeUndefined();
    expect(transaction.contract?.order.intentId).toBe(`0x${"11".repeat(32)}`);
    expect(transaction.contract?.payerEstimate.asset).toBe("ETH");

    expect(harness.planner.calls).toHaveLength(1);
    expect(harness.planner.calls[0]).toMatchObject({
      paymentIntentId: intent.id,
      payerAsset: "ETH",
      chain: "base",
      settlementAsset: "IDRX",
    });
  });

  test("the lock is auditable: the event log carries the signed order fields", async () => {
    const harness = contractHarness();
    const intent = await harness.contractIntent();
    const transaction = await harness.engine.start(intent);

    const events = await harness.engine.history(transaction.id);
    const locked = events.find((event) => event.toState === "PRICE_LOCKED");
    expect(locked?.payload.orderIntentId).toBe(`0x${"11".repeat(32)}`);
    expect(locked?.payload.orderSigner).toBe("0x00000000000000000000000000000000000000a1");
    expect(locked?.payload.payerEstimate).toBeDefined();
  });

  test("a deployment without a planner refuses the contract path", async () => {
    const harness = createHarness();
    const intent = await harness.confirmedIntent({
      payment: { asset: "ETH", chain: "base" },
      executionPath: "on-chain-contract",
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("FAILED");
    expect(transaction.failure?.code).toBe("CONFIGURATION_ERROR");
  });

  test("a planner whose signed order disagrees with its lock is refused", async () => {
    const lock = contractLock();
    const planner = new FakeContractPlanner({
      ...lock,
      order: { ...lock.order, minOut: 1n },
    });
    const harness = createHarness({ contractPlanner: planner });
    const intent = await harness.confirmedIntent({
      payment: { asset: "ETH", chain: "base" },
      executionPath: "on-chain-contract",
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("FAILED");
    expect(transaction.failure?.code).toBe("VALIDATION_ERROR");
  });
});

describe("contract path: completion", () => {
  test("recordPaymentCompleted settles end to end without a deposit or adapter", async () => {
    const harness = contractHarness();
    const intent = await harness.contractIntent();
    const started = await harness.engine.start(intent);

    const { transaction, waiting } = await harness.engine.recordPaymentCompleted(started.id, {
      txHash: TX_HASH,
    });

    expect(waiting).toBe(false);
    expect(transaction.state).toBe("SUCCESS");
    expect(transaction.providerReference).toBe(TX_HASH);
    expect(transaction.contract?.txHash).toBe(TX_HASH);

    // Value flowed in, cleared, and left to the merchant Safe on-chain.
    expect(await harness.balance("TREASURY")).toEqual(IDRX(25_000n));
    expect(await harness.balance("FEE_REVENUE")).toEqual(IDRX(25_000n));
    expect(await harness.balance("MERCHANT_PAYABLE")).toEqual(IDRX(0n));
    expect(await harness.balance("SETTLEMENT_IN_FLIGHT")).toEqual(IDRX(0n));

    const settled = await harness.intents.getById(intent.id);
    expect(settled.status).toBe("COMPLETED");
  });

  test("replaying the completion signal is a no-op", async () => {
    const harness = contractHarness();
    const intent = await harness.contractIntent();
    const started = await harness.engine.start(intent);

    const first = await harness.engine.recordPaymentCompleted(started.id, { txHash: TX_HASH });
    const second = await harness.engine.recordPaymentCompleted(started.id, { txHash: TX_HASH });

    expect(second.transaction.version).toBe(first.transaction.version);
    expect(await harness.balance("TREASURY")).toEqual(IDRX(25_000n));
  });

  test("a completion for a deposit-match payment is refused", async () => {
    const harness = createHarness({ autoConfirmAssetReceipt: false });
    const intent = await harness.confirmedIntent();
    const started = await harness.engine.start(intent);

    expect(harness.engine.recordPaymentCompleted(started.id, { txHash: TX_HASH })).rejects.toThrow(
      /not on the on-chain-contract path/i,
    );
  });
});

describe("contract path: expiry", () => {
  test("waits at the deadline while the grace covers indexing lag", async () => {
    const harness = contractHarness();
    const intent = await harness.contractIntent();
    const started = await harness.engine.start(intent);

    harness.clock.advance(LOCK_TTL_MS + 30_000);
    const progress = await harness.engine.resume(started.id);

    expect(progress.waiting).toBe(true);
    expect(progress.transaction.state).toBe("PAYMENT_PENDING");
  });

  test("fails with QUOTE_EXPIRED past the deadline plus grace, never auto re-quotes", async () => {
    const harness = contractHarness();
    const intent = await harness.contractIntent();
    const started = await harness.engine.start(intent);

    harness.clock.advance(LOCK_TTL_MS + 61_000);
    const progress = await harness.engine.resume(started.id);

    expect(progress.transaction.state).toBe("FAILED");
    expect(progress.transaction.failure?.code).toBe("QUOTE_EXPIRED");
    expect(harness.planner.calls).toHaveLength(1);

    const failed = await harness.intents.getById(intent.id);
    expect(failed.status).toBe("FAILED");
  });

  test("a completion within the grace still settles a payment past its deadline", async () => {
    const harness = contractHarness();
    const intent = await harness.contractIntent();
    const started = await harness.engine.start(intent);

    harness.clock.advance(LOCK_TTL_MS + 30_000);
    const { transaction } = await harness.engine.recordPaymentCompleted(started.id, {
      txHash: TX_HASH,
    });

    expect(transaction.state).toBe("SUCCESS");
  });
});
