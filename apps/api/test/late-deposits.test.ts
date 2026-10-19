import { describe, expect, test } from "bun:test";
import type { ClearingTransaction } from "@mayarin/clearing";
import { FixedClock, money } from "@mayarin/shared";
import { LateDepositService } from "../src/services/late-deposits.ts";

const NOW = new Date("2026-01-02T00:00:00.000Z");
const EXPIRED_AT = new Date("2026-01-01T23:00:00.000Z");

function transaction(id: string, required: bigint): ClearingTransaction {
  return {
    id,
    paymentIntentId: `pi_${id}`,
    state: "FAILED",
    failure: {
      reason: "payment expired before funds arrived",
      code: "PAYMENT_EXPIRED",
      at: EXPIRED_AT,
    },
    deposit: {
      asset: "USDC",
      chain: "base-sepolia",
      address: `0xaddr_${id}`,
      amount: money(required, "USDC"),
    },
  } as unknown as ClearingTransaction;
}

function service(received: Record<string, bigint>, expired: ClearingTransaction[]) {
  const accepted: string[] = [];
  const asked: Date[] = [];
  const late = new LateDepositService({
    clock: new FixedClock(NOW),
    windowMs: 24 * 60 * 60_000,
    engine: {
      listExpired: async (since) => {
        asked.push(since);
        return expired;
      },
      getById: async (id) => {
        const found = expired.find((t) => t.id === id);
        if (found === undefined) throw new Error("missing");
        return found;
      },
      acceptLateFunds: async (id) => {
        accepted.push(id);
        return { transaction: expired.find((t) => t.id === id) as ClearingTransaction } as never;
      },
    },
    deposits: {
      confirmedTotal: async (_chain, address) => money(received[address] ?? 0n, "USDC"),
    },
  });
  return { late, accepted, asked };
}

describe("LateDepositService", () => {
  const a = transaction("a", 5_000_000n);
  const b = transaction("b", 5_000_000n);

  test("lists only expired payments whose confirmed deposit covers what was asked", async () => {
    const { late } = service({ "0xaddr_a": 5_000_000n, "0xaddr_b": 4_999_999n }, [a, b]);
    const found = await late.list();
    expect(found.map((item) => item.clearingTransactionId)).toEqual(["a"]);
    expect(found[0]).toMatchObject({
      paymentIntentId: "pi_a",
      chain: "base-sepolia",
      expiredAt: EXPIRED_AT,
    });
  });

  test("a deposit above the amount counts, a missing one does not", async () => {
    const { late } = service({ "0xaddr_a": 9_000_000n }, [a, b]);
    expect((await late.list()).map((item) => item.clearingTransactionId)).toEqual(["a"]);
  });

  test("looks back as far as the watcher keeps deposits", async () => {
    const { late, asked } = service({}, [a]);
    await late.list();
    expect(asked[0]?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  test("accepting checks the funds again, and only then reopens", async () => {
    const { late, accepted } = service({ "0xaddr_a": 5_000_000n }, [a, b]);
    await late.accept("a");
    expect(accepted).toEqual(["a"]);

    await expect(late.accept("b")).rejects.toThrow("No confirmed deposit covers");
    expect(accepted).toEqual(["a"]);
  });

  test("accepting a payment that does not exist is a 404, not a reopen", async () => {
    const { late, accepted } = service({}, [a]);
    await expect(late.accept("nope")).rejects.toThrow("No such payment");
    expect(accepted).toEqual([]);
  });
});
