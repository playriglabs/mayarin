import { describe, expect, test } from "bun:test";
import { FixedClock } from "../src/clock.ts";
import {
  DEFAULT_GRACE_MS,
  InMemoryOperatorTransactionStore,
  type OperatorChainReader,
  type OperatorTransaction,
  OperatorTransactionReconciler,
} from "../src/operator-transactions.ts";

const KEY = "base:0xabc";
const START = "2026-01-01T00:00:00.000Z";

function setup(chain: Partial<OperatorChainReader> = {}) {
  const clock = new FixedClock(START);
  const store = new InMemoryOperatorTransactionStore();
  const reader: OperatorChainReader = {
    confirmedNonce: async () => 0,
    receipt: async () => undefined,
    ...chain,
  };
  const reconciler = new OperatorTransactionReconciler({ store, chain: reader, clock });
  const add = (row: Partial<OperatorTransaction> & Pick<OperatorTransaction, "id" | "status">) =>
    store.rows.push({
      key: KEY,
      nonce: 5,
      allocatedAt: clock.now(),
      ...row,
    });
  const statusOf = (id: string) => store.rows.find((row) => row.id === id)?.status;
  const pastGrace = () => clock.advance(DEFAULT_GRACE_MS + 1);
  return { add, reconciler, statusOf, pastGrace };
}

describe("OperatorTransactionReconciler", () => {
  test("leaves a transaction alone while it may still be in flight", async () => {
    const { add, reconciler, statusOf } = setup({ receipt: async () => "success" });
    add({ id: "a", status: "submitted", txHash: "0x1" });
    expect(await reconciler.run()).toEqual([]);
    expect(statusOf("a")).toBe("submitted");
  });

  test("finalizes a transaction that has a successful receipt", async () => {
    const { add, reconciler, statusOf, pastGrace } = setup({ receipt: async () => "success" });
    add({ id: "a", status: "submitted", txHash: "0x1" });
    pastGrace();
    expect(await reconciler.run()).toEqual([]);
    expect(statusOf("a")).toBe("finalized");
  });

  test("reports a revert: the nonce is spent and the payment is not", async () => {
    const { add, reconciler, statusOf, pastGrace } = setup({ receipt: async () => "reverted" });
    add({ id: "a", status: "submitted", txHash: "0x1" });
    pastGrace();
    const [finding] = await reconciler.run();
    expect(finding).toMatchObject({ finding: "reverted", id: "a", nonce: 5, txHash: "0x1" });
    expect(statusOf("a")).toBe("reverted");
  });

  test("reports a transaction stuck without a receipt, and keeps it open", async () => {
    const { add, reconciler, statusOf, pastGrace } = setup({ confirmedNonce: async () => 5 });
    add({ id: "a", status: "submitted", txHash: "0x1" });
    pastGrace();
    const [finding] = await reconciler.run();
    expect(finding).toMatchObject({ finding: "stuck", id: "a" });
    expect(statusOf("a")).toBe("submitted");
  });

  test("a nonce the chain moved past without our hash was replaced", async () => {
    const { add, reconciler, statusOf, pastGrace } = setup({ confirmedNonce: async () => 6 });
    add({ id: "a", status: "submitted", txHash: "0x1" });
    pastGrace();
    const [finding] = await reconciler.run();
    expect(finding).toMatchObject({ finding: "replaced", id: "a" });
    expect(statusOf("a")).toBe("replaced");
  });

  test("an allocated nonce the chain never reached is abandoned quietly", async () => {
    const { add, reconciler, statusOf, pastGrace } = setup({ confirmedNonce: async () => 5 });
    add({ id: "a", status: "allocated" });
    pastGrace();
    expect(await reconciler.run()).toEqual([]);
    expect(statusOf("a")).toBe("abandoned");
  });

  test("an allocated nonce the chain moved past may have landed unrecorded", async () => {
    const { add, reconciler, statusOf, pastGrace } = setup({ confirmedNonce: async () => 6 });
    add({ id: "a", status: "allocated" });
    pastGrace();
    const [finding] = await reconciler.run();
    expect(finding).toMatchObject({ finding: "unrecorded", id: "a", nonce: 5 });
    expect(statusOf("a")).toBe("abandoned");
  });

  test("closed rows are not looked at again", async () => {
    const { add, reconciler, pastGrace } = setup({ receipt: async () => "reverted" });
    add({ id: "a", status: "finalized", txHash: "0x1" });
    pastGrace();
    expect(await reconciler.run()).toEqual([]);
  });
});
