import { describe, expect, test } from "bun:test";
import { awaitsFacilitatorSettlement, usesDepositAddress } from "@mayarin/payment-intent";
import { createHarness } from "./harness.ts";

/**
 * The x402 path through the engine.
 *
 * There is almost no new code behind these tests, and that is the point. x402
 * reuses the deposit path's second half — receipt, clearing, settlement through
 * the adapter — and differs in exactly two places: it derives no deposit
 * address, and nothing but a confirmed settlement may advance it out of
 * `PAYMENT_PENDING`. Both are things a *third* variant could break silently in
 * a codebase whose branches were all written as "is this the contract path".
 */
describe("x402 execution path", () => {
  test("reaches PAYMENT_PENDING and waits there", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/USDC": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("PAYMENT_PENDING");
  });

  // The payer never sees an address. A payment is identified by the
  // authorization nonce, so deriving one would be an unused address per 402 —
  // and most 402s are never paid.
  test("derives no deposit address", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/USDC": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.deposit).toBeUndefined();
  });

  // The whole hazard of adding a third variant. `autoConfirmAssetReceipt` is
  // the development stand-in for the wallet watcher, and every branch guarding
  // it used to ask "is this not the contract path" — which answers yes for
  // x402. Left alone, this test would credit a merchant for an authorization
  // nobody had broadcast.
  test("is not advanced by the watcher stand-in, even with it enabled", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: true,
      rates: { "IDR/USDC": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("PAYMENT_PENDING");
  });

  test("a deposit payment is still advanced by the stand-in", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: true,
      rates: { "IDR/USDC": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "deposit-match",
    });

    const transaction = await harness.engine.start(intent);

    expect(transaction.state).toBe("SUCCESS");
  });

  test("settles through the adapter once receipt is recorded", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/USDC": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });
    const started = await harness.engine.start(intent);

    const { transaction } = await harness.engine.recordAssetReceived(started.id);

    expect(transaction.state).toBe("SUCCESS");
  });

  // The engine's existing rule, which x402 inherits rather than reimplements:
  // a step repeated after a crash is a no-op, not a second payment.
  test("recording receipt twice does not clear twice", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/USDC": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });
    const started = await harness.engine.start(intent);

    const first = await harness.engine.recordAssetReceived(started.id);
    const second = await harness.engine.recordAssetReceived(started.id);

    expect(first.transaction.state).toBe("SUCCESS");
    expect(second.transaction.state).toBe("SUCCESS");
    expect(second.transaction.version).toBe(first.transaction.version);
  });

  /**
   * The crash the x402 service's ordering is designed around.
   *
   * `settle` broadcasts before the receipt is written, so a process that dies in
   * between leaves an intent whose money has moved on-chain and whose engine
   * knows nothing about it. The recovery is not an x402 mechanism — it is the
   * engine's own `resumeStuck`, and the point of testing it here is that a path
   * which derives no deposit address and is advanced by nothing but a
   * facilitator could quietly fall outside it.
   */
  test("resumeStuck recovers an intent killed between settle and the receipt", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      behaviour: "pending",
      rates: { "IDR/USDC": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });
    const started = await harness.engine.start(intent);

    // The facilitator broadcast, and the process died before the receipt.
    const settling = await harness.engine.recordAssetReceived(started.id);
    expect(settling.transaction.state).toBe("SETTLING");
    harness.adapter.complete(settling.transaction.providerReference as string);

    const [resumed] = await harness.engine.resumeStuck();

    expect(resumed?.transaction.id).toBe(started.id);
    expect(resumed?.transaction.state).toBe("SUCCESS");
    expect(await harness.engine.resumeStuck()).toHaveLength(0);
  });
});

describe("execution path predicates", () => {
  // These two are the reason the engine no longer asks `!== "on-chain-contract"`
  // anywhere it means "deposit". That phrasing was right with two paths and
  // wrong the moment there were three.
  test("undefined still means deposit-match, as the field's default says", () => {
    expect(usesDepositAddress(undefined)).toBe(true);
    expect(usesDepositAddress("deposit-match")).toBe(true);
  });

  test("neither on-chain-contract nor x402 funds through an address", () => {
    expect(usesDepositAddress("on-chain-contract")).toBe(false);
    expect(usesDepositAddress("x402")).toBe(false);
  });

  test("only x402 waits on a facilitator", () => {
    expect(awaitsFacilitatorSettlement("x402")).toBe(true);
    expect(awaitsFacilitatorSettlement("deposit-match")).toBe(false);
    expect(awaitsFacilitatorSettlement("on-chain-contract")).toBe(false);
    expect(awaitsFacilitatorSettlement(undefined)).toBe(false);
  });
});
