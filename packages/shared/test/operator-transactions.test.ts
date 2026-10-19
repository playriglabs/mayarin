import { describe, expect, test } from "bun:test";
import { FixedClock } from "../src/clock.ts";
import {
  DEFAULT_GRACE_MS,
  InMemoryOperatorTransactionStore,
  MAX_BUMPS,
  type OperatorChainReader,
  type OperatorTransaction,
  type OperatorTransactionBumper,
  OperatorTransactionReconciler,
} from "../src/operator-transactions.ts";

const KEY = "base:0xabc";
const START = "2026-01-01T00:00:00.000Z";

const CALL = { to: "0xdef", data: "0x1234", value: 0n };

function setup(chain: Partial<OperatorChainReader> = {}, bumper?: OperatorTransactionBumper) {
  const clock = new FixedClock(START);
  const store = new InMemoryOperatorTransactionStore();
  const reader: OperatorChainReader = {
    confirmedNonce: async () => 0,
    receipt: async () => undefined,
    ...chain,
  };
  const reconciler = new OperatorTransactionReconciler({
    store,
    chain: reader,
    clock,
    ...(bumper === undefined ? {} : { bumper }),
  });
  const add = (row: Partial<OperatorTransaction> & Pick<OperatorTransaction, "id" | "status">) =>
    store.rows.push({
      key: KEY,
      nonce: 5,
      bumpCount: 0,
      allocatedAt: clock.now(),
      ...row,
    });
  const rowOf = (id: string) => store.rows.find((row) => row.id === id);
  const statusOf = (id: string) => store.rows.find((row) => row.id === id)?.status;
  const pastGrace = () => clock.advance(DEFAULT_GRACE_MS + 1);
  return { add, reconciler, statusOf, rowOf, pastGrace };
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

  describe("replacing a stuck transaction", () => {
    test("replaces it under its own nonce and starts the grace period again", async () => {
      let bumps = 0;
      const bumper = {
        bump: async () => {
          bumps++;
          return "0x2";
        },
      };
      const { add, reconciler, rowOf, pastGrace } = setup({}, bumper);
      add({ id: "a", status: "submitted", txHash: "0x1", call: CALL });
      pastGrace();
      const [finding] = await reconciler.run();
      expect(finding).toMatchObject({ finding: "bumped", id: "a" });
      expect(rowOf("a")).toMatchObject({ txHash: "0x2", bumpCount: 1, status: "submitted" });
      expect(await reconciler.run()).toEqual([]);
      expect(bumps).toBe(1);
    });

    test("stops after MAX_BUMPS and reports the row as stuck", async () => {
      let calls = 0;
      const { add, reconciler, pastGrace } = setup(
        {},
        {
          bump: async () => {
            calls++;
            return "0x9";
          },
        },
      );
      add({ id: "a", status: "submitted", txHash: "0x1", call: CALL, bumpCount: MAX_BUMPS });
      pastGrace();
      expect(await reconciler.run()).toMatchObject([{ finding: "stuck" }]);
      expect(calls).toBe(0);
    });

    test("leaves a row with no recorded call alone", async () => {
      const bump = async () => "0x2";
      const { add, reconciler, pastGrace } = setup({}, { bump });
      add({ id: "a", status: "submitted", txHash: "0x1" });
      pastGrace();
      expect(await reconciler.run()).toMatchObject([{ finding: "stuck" }]);
    });

    test("a failed bump is reported as stuck and retried on the next pass", async () => {
      const { add, reconciler, rowOf, pastGrace } = setup(
        {},
        {
          bump: async () => {
            throw new Error("nonce too low");
          },
        },
      );
      add({ id: "a", status: "submitted", txHash: "0x1", call: CALL });
      pastGrace();
      expect(await reconciler.run()).toMatchObject([{ finding: "stuck" }]);
      expect(rowOf("a")).toMatchObject({ txHash: "0x1", bumpCount: 0 });
    });
  });
});
