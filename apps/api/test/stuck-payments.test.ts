import { describe, expect, test } from "bun:test";
import type { ClearingState, ClearingTransaction } from "@mayarin/clearing";
import { createStuckPaymentCheck, findStuck } from "../src/services/stuck-payments.ts";

const NOW = new Date("2026-10-24T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function transaction(id: string, state: ClearingState, updatedAt: Date): ClearingTransaction {
  return { id, state, updatedAt } as ClearingTransaction;
}

describe("findStuck", () => {
  test("a paid payment unfinished for ten minutes is stuck", () => {
    const found = findStuck(
      [
        transaction("a", "SETTLING", minutesAgo(11)),
        transaction("b", "CLEARING", minutesAgo(3)),
        transaction("c", "ASSET_RECEIVED", minutesAgo(10)),
      ],
      NOW,
    );
    expect(found.map((t) => t.id)).toEqual(["a", "c"]);
  });

  test("a payer who has not paid yet is not stuck, however long it takes", () => {
    expect(findStuck([transaction("a", "PAYMENT_PENDING", minutesAgo(600))], NOW)).toEqual([]);
  });
});

describe("stuck payment check", () => {
  function setup(transactions: () => ClearingTransaction[]) {
    const sent: string[] = [];
    const check = createStuckPaymentCheck({
      list: async () => transactions(),
      now: () => NOW,
      send: async (text) => {
        sent.push(text);
      },
    });
    return { check, sent };
  }

  test("reports a payment once, not on every pass", async () => {
    const { check, sent } = setup(() => [transaction("a", "SETTLING", minutesAgo(15))]);
    expect(await check()).toHaveLength(1);
    expect(await check()).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Payment a has been in SETTLING for 15 min");
  });

  test("reports again when the payment moves on and sticks in another state", async () => {
    let state: ClearingState = "CLEARING";
    const { check, sent } = setup(() => [transaction("a", state, minutesAgo(12))]);
    await check();
    state = "SETTLING";
    await check();
    expect(sent).toHaveLength(2);
  });

  test("reports again after it recovered and stuck later", async () => {
    let list: ClearingTransaction[] = [transaction("a", "SETTLING", minutesAgo(12))];
    const { check, sent } = setup(() => list);
    await check();
    list = [];
    await check();
    list = [transaction("a", "SETTLING", minutesAgo(12))];
    await check();
    expect(sent).toHaveLength(2);
  });

  test("a failed send is retried on the next pass", async () => {
    let fail = true;
    const sent: string[] = [];
    const check = createStuckPaymentCheck({
      list: async () => [transaction("a", "SETTLING", minutesAgo(12))],
      now: () => NOW,
      send: async (text) => {
        if (fail) throw new Error("webhook down");
        sent.push(text);
      },
    });
    await expect(check()).rejects.toThrow("webhook down");
    fail = false;
    expect(await check()).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});
