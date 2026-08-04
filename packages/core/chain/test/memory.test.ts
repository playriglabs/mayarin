import { describe, expect, test } from "bun:test";
import { money } from "@mayarin/shared";
import type { TransferLog } from "../src/index.ts";
import {
  FixedDepositAddressDeriver,
  InMemoryDepositAddressRepository,
  InMemoryDepositRepository,
  InMemoryWatcherCursorRepository,
} from "../testing/index.ts";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const CHAIN = "base-sepolia" as const;
const deriver = new FixedDepositAddressDeriver();

function transferLog(overrides: Partial<TransferLog> = {}): TransferLog {
  return {
    chain: CHAIN,
    asset: "USDC",
    txHash: "0xtx1",
    logIndex: 0,
    blockNumber: 10n,
    blockHash: "0xb10",
    from: "0xfrom",
    to: deriver.derive(1),
    amount: 1_000_000n,
    ...overrides,
  };
}

describe("InMemoryDepositAddressRepository", () => {
  test("allocates increasing derivation indices", async () => {
    const repository = new InMemoryDepositAddressRepository();
    const first = await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });
    const second = await repository.allocate({
      clearingTransactionId: "clr_2",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });

    expect(second.derivationIndex).toBe(first.derivationIndex + 1);
    expect(second.address).not.toBe(first.address);
  });

  test("allocating twice for one transaction returns the same address", async () => {
    const repository = new InMemoryDepositAddressRepository();
    const first = await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });
    const again = await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });

    expect(again.address).toBe(first.address);
    expect(again.derivationIndex).toBe(first.derivationIndex);
  });

  test("lists non-terminal addresses as fundable", async () => {
    const repository = new InMemoryDepositAddressRepository(() => ({
      fundable: true,
      requiredAmount: money(1_000_000n, "USDC"),
    }));
    await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });

    const watched = await repository.listWatched(CHAIN, NOW);
    expect(watched).toHaveLength(1);
    expect(watched[0]?.fundable).toBe(true);
  });

  test("drops terminal addresses older than the retention cutoff", async () => {
    const repository = new InMemoryDepositAddressRepository(() => ({
      fundable: false,
      requiredAmount: money(1_000_000n, "USDC"),
      terminalAt: new Date("2025-12-01T00:00:00.000Z"),
    }));
    await repository.allocate({
      clearingTransactionId: "clr_1",
      chain: CHAIN,
      asset: "USDC",
      deriver,
      now: NOW,
    });

    expect(await repository.listWatched(CHAIN, NOW)).toHaveLength(0);
  });
});

describe("InMemoryDepositRepository", () => {
  test("records a transfer once, however often it is seen", async () => {
    const repository = new InMemoryDepositRepository();
    await repository.record([transferLog()], NOW);
    await repository.record([transferLog()], NOW);

    expect(await repository.listByAddress(CHAIN, deriver.derive(1))).toHaveLength(1);
  });

  test("treats a different log index in the same transaction as a separate deposit", async () => {
    const repository = new InMemoryDepositRepository();
    await repository.record([transferLog(), transferLog({ logIndex: 1 })], NOW);

    expect(await repository.listByAddress(CHAIN, deriver.derive(1))).toHaveLength(2);
  });

  test("counts only CONFIRMED deposits in the total", async () => {
    const repository = new InMemoryDepositRepository();
    const [first, second] = await repository.record(
      [transferLog(), transferLog({ txHash: "0xtx2", amount: 500_000n })],
      NOW,
    );
    if (first === undefined || second === undefined) throw new Error("expected two deposits");

    await repository.updateStatuses([{ id: first.id, status: "CONFIRMED", at: NOW }]);

    const total = await repository.confirmedTotal(CHAIN, deriver.derive(1), "USDC");
    expect(total.amount).toBe(1_000_000n);
  });

  test("an orphaned deposit stops counting", async () => {
    const repository = new InMemoryDepositRepository();
    const [deposit] = await repository.record([transferLog()], NOW);
    if (deposit === undefined) throw new Error("expected a deposit");

    await repository.updateStatuses([{ id: deposit.id, status: "CONFIRMED", at: NOW }]);
    await repository.updateStatuses([{ id: deposit.id, status: "ORPHANED", at: NOW }]);

    const total = await repository.confirmedTotal(CHAIN, deriver.derive(1), "USDC");
    expect(total.amount).toBe(0n);
  });

  test("keeps both timestamps when a confirmed deposit is orphaned", async () => {
    const repository = new InMemoryDepositRepository();
    const [deposit] = await repository.record([transferLog()], NOW);
    if (deposit === undefined) throw new Error("expected a deposit");

    await repository.updateStatuses([{ id: deposit.id, status: "CONFIRMED", at: NOW }]);
    await repository.updateStatuses([{ id: deposit.id, status: "ORPHANED", at: NOW }]);

    const [stored] = await repository.listByAddress(CHAIN, deriver.derive(1));
    expect(stored?.confirmedAt).toBeDefined();
    expect(stored?.orphanedAt).toBeDefined();
  });
});

describe("InMemoryWatcherCursorRepository", () => {
  test("returns null before anything is scanned", async () => {
    const repository = new InMemoryWatcherCursorRepository();
    expect(await repository.get(CHAIN, "USDC")).toBeNull();
  });

  test("round-trips a cursor per chain and asset", async () => {
    const repository = new InMemoryWatcherCursorRepository();
    await repository.set(CHAIN, "USDC", 42n);

    expect(await repository.get(CHAIN, "USDC")).toBe(42n);
    expect(await repository.get(CHAIN, "USDT")).toBeNull();
  });
});
