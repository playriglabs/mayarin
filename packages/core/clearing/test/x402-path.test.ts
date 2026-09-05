import { describe, expect, spyOn, test } from "bun:test";
import { awaitsFacilitatorSettlement, usesDepositAddress } from "@mayarin/payment-intent";
import { ProviderError } from "@mayarin/shared";
import type { ClearingTransaction } from "../src/types.ts";
import { createHarness } from "./harness.ts";

const TX_HASH = `0x${"ab".repeat(32)}`;

function completion(transaction: ClearingTransaction) {
  if (transaction.settlementAmount === undefined) throw new Error("Missing lock");
  return { chain: "base-sepolia" as const, txHash: TX_HASH, amount: transaction.settlementAmount };
}

/** Direct payouts are booked from confirmed evidence and never paid again. */
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

  test("books the direct payout without a fee or a second settlement", async () => {
    const harness = createHarness({
      autoConfirmAssetReceipt: false,
      rates: { "IDR/USDC": 100n },
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });
    const started = await harness.engine.start(intent);

    const settle = spyOn(harness.adapter, "settle");
    const status = spyOn(harness.adapter, "status");
    const { transaction } = await harness.engine.recordFacilitatorSettlement(
      started.id,
      completion(started),
    );

    expect(transaction.state).toBe("SUCCESS");
    expect(transaction.fee?.amount).toBe(0n);
    expect(transaction.netAmount).toEqual(transaction.settlementAmount);
    expect(transaction.onChain?.settledAmount).toEqual(transaction.settlementAmount);
    expect(transaction.providerReference).toBe(TX_HASH);
    expect(settle).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect((await harness.balance("TREASURY")).amount).toBe(0n);
    expect((await harness.balance("FEE_REVENUE")).amount).toBe(0n);
    const postings = await harness.ledger.transactionsFor(started.id);
    expect(postings).toHaveLength(3);
    expect(
      postings
        .flatMap((posting) => posting.entries)
        .some((entry) => entry.accountCode === "FEE_REVENUE:USDC"),
    ).toBe(false);
    settle.mockRestore();
    status.mockRestore();
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

    const first = await harness.engine.recordFacilitatorSettlement(started.id, completion(started));
    const second = await harness.engine.recordFacilitatorSettlement(
      started.id,
      completion(started),
    );

    expect(first.transaction.state).toBe("SUCCESS");
    expect(second.transaction.state).toBe("SUCCESS");
    expect(second.transaction.version).toBe(first.transaction.version);
  });

  test("an internal adapter cannot turn a direct transfer into a merchant holding", async () => {
    const harness = createHarness({
      mode: "internal",
      behaviour: "fail",
      autoConfirmAssetReceipt: false,
    });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });
    const started = await harness.engine.start(intent);
    const { transaction } = await harness.engine.recordFacilitatorSettlement(
      started.id,
      completion(started),
    );
    expect(transaction.state).toBe("SUCCESS");
    expect((await harness.balance("MERCHANT_HOLDING")).amount).toBe(0n);
  });

  test("a bare receipt signal cannot credit an x402 payment", async () => {
    const harness = createHarness();
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });
    const started = await harness.engine.start(intent);
    await expect(harness.engine.recordAssetReceived(started.id)).rejects.toThrow(
      "confirmed facilitator settlement",
    );
    expect(await harness.ledger.transactionsFor(started.id)).toHaveLength(0);
  });

  test("refuses a transfer on another chain or for another amount", async () => {
    const harness = createHarness();
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });
    const started = await harness.engine.start(intent);
    const paid = completion(started);
    await expect(
      harness.engine.recordFacilitatorSettlement(started.id, { ...paid, chain: "arc-testnet" }),
    ).rejects.toThrow("disagrees");
    await expect(
      harness.engine.recordFacilitatorSettlement(started.id, {
        ...paid,
        amount: { ...paid.amount, amount: 1n },
      }),
    ).rejects.toThrow("disagrees");
    expect(await harness.ledger.transactionsFor(started.id)).toHaveLength(0);
  });

  test("resumeStuck finishes a confirmed payout after a posting failure without paying again", async () => {
    const harness = createHarness({ autoConfirmAssetReceipt: false, behaviour: "fail" });
    const intent = await harness.confirmedIntent({
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "x402",
    });
    const started = await harness.engine.start(intent);
    const post = harness.ledger.post.bind(harness.ledger);
    const unavailable = spyOn(harness.ledger, "post").mockImplementation(async (draft) => {
      if (draft.idempotencyKey?.endsWith(":CLEARING"))
        throw new ProviderError("Database unavailable");
      return post(draft);
    });
    await expect(
      harness.engine.recordFacilitatorSettlement(started.id, completion(started)),
    ).rejects.toThrow("Database unavailable");
    unavailable.mockRestore();
    const persisted = await harness.engine.getById(started.id);
    expect(persisted.state).toBe("ASSET_RECEIVED");
    expect(persisted.providerReference).toBe(TX_HASH);
    expect(persisted.onChain?.fee.amount).toBe(0n);
    const [resumed] = await harness.engine.resumeStuck();
    expect(resumed?.transaction.state).toBe("SUCCESS");
    expect(resumed?.transaction.providerReference).toBe(TX_HASH);
    expect(await harness.ledger.transactionsFor(started.id)).toHaveLength(3);
    expect(await harness.engine.resumeStuck()).toHaveLength(0);
  });

  // The hole this closes: a facilitator broadcast whose confirmation then threw
  // left value moved on a chain and no pointer to it anywhere — and EIP-3009
  // will not let the same authorization be sent twice, so nothing could
  // recover it.
  describe("recordFacilitatorBroadcast", () => {
    async function pending() {
      const harness = createHarness({ autoConfirmAssetReceipt: false });
      const intent = await harness.confirmedIntent({
        payment: { asset: "USDC", chain: "base-sepolia" },
        executionPath: "x402",
      });
      return { harness, started: await harness.engine.start(intent) };
    }

    test("keeps the hash without moving the payment", async () => {
      const { harness, started } = await pending();

      const recorded = await harness.engine.recordFacilitatorBroadcast(started.id, TX_HASH);

      expect(recorded.state).toBe("PAYMENT_PENDING");
      expect(recorded.providerReference).toBe(TX_HASH);
      const persisted = await harness.engine.getById(started.id);
      expect(persisted.providerReference).toBe(TX_HASH);
      expect(persisted.state).toBe("PAYMENT_PENDING");
      const events = await harness.repositories.clearing.listEvents(started.id);
      expect(events.at(-1)?.type).toBe("settlement.broadcast");
    });

    test("credits nothing on its own", async () => {
      const { harness, started } = await pending();

      await harness.engine.recordFacilitatorBroadcast(started.id, TX_HASH);

      expect(await harness.ledger.transactionsFor(started.id)).toHaveLength(0);
    });

    // The resume case: the same broadcast reported twice is one broadcast.
    test("is idempotent for the same hash", async () => {
      const { harness, started } = await pending();

      await harness.engine.recordFacilitatorBroadcast(started.id, TX_HASH);
      const again = await harness.engine.recordFacilitatorBroadcast(started.id, TX_HASH);

      expect(again.providerReference).toBe(TX_HASH);
      const events = await harness.repositories.clearing.listEvents(started.id);
      expect(events.filter((event) => event.type === "settlement.broadcast")).toHaveLength(1);
    });

    test("refuses a second, different hash", async () => {
      const { harness, started } = await pending();
      await harness.engine.recordFacilitatorBroadcast(started.id, TX_HASH);

      await expect(
        harness.engine.recordFacilitatorBroadcast(started.id, `0x${"cd".repeat(32)}`),
      ).rejects.toThrow(/already has a different settlement reference/);
    });

    test("refuses anything that is not a transaction hash", async () => {
      const { harness, started } = await pending();

      await expect(
        harness.engine.recordFacilitatorBroadcast(started.id, "pending"),
      ).rejects.toThrow(/not a transaction hash/);
    });

    test("refuses a payment that does not settle through a facilitator", async () => {
      const harness = createHarness({ autoConfirmAssetReceipt: false });
      const intent = await harness.confirmedIntent({
        payment: { asset: "USDC", chain: "base-sepolia" },
      });
      const started = await harness.engine.start(intent);

      await expect(harness.engine.recordFacilitatorBroadcast(started.id, TX_HASH)).rejects.toThrow(
        /Only an x402 payment/,
      );
    });

    // Expiry describes a payer who never paid. A payment holding a broadcast
    // hash was paid, and failing it would bury the money it moved.
    test("keeps the expiry sweep off a payment that has been broadcast", async () => {
      const { harness, started } = await pending();
      await harness.engine.recordFacilitatorBroadcast(started.id, TX_HASH);
      harness.clock.advance(60 * 60 * 1000);

      expect(await harness.engine.sweepExpired()).toHaveLength(0);
      expect((await harness.engine.getById(started.id)).state).toBe("PAYMENT_PENDING");
    });

    test("but still sweeps one nobody ever paid", async () => {
      const { harness, started } = await pending();
      harness.clock.advance(60 * 60 * 1000);

      expect(await harness.engine.sweepExpired()).toHaveLength(1);
      expect((await harness.engine.getById(started.id)).state).toBe("FAILED");
    });

    // The whole point: the hash survives the failure, so the payment can still
    // be finished from it.
    test("survives a confirmation that throws, and settles afterwards", async () => {
      const { harness, started } = await pending();
      await harness.engine.recordFacilitatorBroadcast(started.id, TX_HASH);

      const stranded = await harness.engine.getById(started.id);
      expect(stranded.providerReference).toBe(TX_HASH);

      const progress = await harness.engine.recordFacilitatorSettlement(
        started.id,
        completion(stranded),
      );

      expect(progress.transaction.state).toBe("SUCCESS");
      expect(progress.transaction.providerReference).toBe(TX_HASH);
      expect(await harness.ledger.transactionsFor(started.id)).toHaveLength(3);
    });
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
