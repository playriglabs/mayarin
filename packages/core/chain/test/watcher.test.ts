import { beforeEach, describe, expect, test } from "bun:test";
import {
  InMemoryDepositAddressRepository,
  InMemoryDepositRepository,
  InMemoryWatcherCursorRepository,
  type WatchedTransactionState,
} from "@mayarin/db/memory";
import { FakeChainClient, FixedDepositAddressDeriver } from "@mayarin/provider-mock-chain";
import { type DomainEvent, FixedClock, InMemoryEventBus, money } from "@mayarin/shared";
import { WalletWatcher } from "../src/watcher.ts";

const CHAIN = "base-sepolia" as const;
const ASSET = "USDC" as const;
const NOW = "2026-01-01T00:00:00.000Z";
/** 3.21 USDC, six decimals. */
const REQUIRED = money(3_210_000n, ASSET);

function createHarness() {
  const clock = new FixedClock(NOW);
  const chain = new FakeChainClient();
  const deriver = new FixedDepositAddressDeriver();
  const funded: string[] = [];
  const published: DomainEvent[] = [];

  const events = new InMemoryEventBus();
  events.subscribe("*", (event) => {
    published.push(event);
  });

  const state = new Map<string, WatchedTransactionState>();
  const addresses = new InMemoryDepositAddressRepository((id) => state.get(id));
  const deposits = new InMemoryDepositRepository();
  const cursors = new InMemoryWatcherCursorRepository();

  const watcher = new WalletWatcher({
    client: chain,
    addresses,
    deposits,
    cursors,
    clock,
    events,
    sink: {
      fund: async (clearingTransactionId) => {
        // recordAssetReceived moves the transaction out of PAYMENT_PENDING, so a
        // replayed tick finds it no longer fundable. Modelling that here is what
        // makes funding idempotent without a guard inside the watcher.
        funded.push(clearingTransactionId);
        const existing = state.get(clearingTransactionId);
        if (existing !== undefined) {
          state.set(clearingTransactionId, { ...existing, fundable: false });
        }
      },
    },
    policy: { depth: 6, reorgWatchWindow: 2 },
    blockRange: 2000,
    retentionSeconds: 86_400,
  });

  /** Registers a payment awaiting `REQUIRED` and returns its deposit address. */
  async function awaitingPayment(id = "clr_1"): Promise<string> {
    state.set(id, { fundable: true, requiredAmount: REQUIRED });
    const allocated = await addresses.allocate({
      clearingTransactionId: id,
      chain: CHAIN,
      asset: ASSET,
      deriver,
      now: clock.now(),
    });
    return allocated.address;
  }

  return {
    chain,
    watcher,
    addresses,
    deposits,
    cursors,
    funded,
    published,
    state,
    awaitingPayment,
  };
}

describe("WalletWatcher", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  test("a deposit below the confirmation depth does not fund", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({ asset: ASSET, to: address, amount: REQUIRED.amount });
    harness.chain.mine(3);

    const result = await harness.watcher.tick(CHAIN, ASSET);

    expect(result.recorded).toBe(1);
    expect(result.funded).toBe(0);
    expect(harness.funded).toEqual([]);
  });

  test("a deposit reaching the depth funds the payment exactly once", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({ asset: ASSET, to: address, amount: REQUIRED.amount });
    harness.chain.mine(6);

    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual(["clr_1"]);

    harness.chain.mine(1);
    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual(["clr_1"]);
  });

  test("two half-sends accumulate and fund on the second", async () => {
    const address = await harness.awaitingPayment();

    harness.chain.transfer({ asset: ASSET, to: address, amount: 2_000_000n });
    harness.chain.mine(6);
    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual([]);

    harness.chain.transfer({ asset: ASSET, to: address, amount: 1_210_000n });
    harness.chain.mine(6);
    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual(["clr_1"]);
  });

  test("an overpayment funds and the excess stays on the record", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({ asset: ASSET, to: address, amount: 5_000_000n });
    harness.chain.mine(6);

    await harness.watcher.tick(CHAIN, ASSET);

    expect(harness.funded).toEqual(["clr_1"]);
    const total = await harness.deposits.confirmedTotal(CHAIN, address, ASSET);
    expect(total.amount).toBe(5_000_000n);
  });

  test("a reorg below the depth orphans the deposit and nothing was ever funded", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({ asset: ASSET, to: address, amount: REQUIRED.amount });
    harness.chain.mine(3);
    await harness.watcher.tick(CHAIN, ASSET);

    harness.chain.reorg({ depth: 3 });
    await harness.watcher.tick(CHAIN, ASSET);

    const [deposit] = await harness.deposits.listByAddress(CHAIN, address);
    expect(deposit?.status).toBe("ORPHANED");
    expect((await harness.deposits.confirmedTotal(CHAIN, address, ASSET)).amount).toBe(0n);
    expect(harness.funded).toEqual([]);
  });

  test("a reorg above the depth records the orphan and publishes an event", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({ asset: ASSET, to: address, amount: REQUIRED.amount });
    harness.chain.mine(6);
    await harness.watcher.tick(CHAIN, ASSET);
    expect(harness.funded).toEqual(["clr_1"]);

    harness.chain.reorg({ depth: 6 });
    await harness.watcher.tick(CHAIN, ASSET);

    const [deposit] = await harness.deposits.listByAddress(CHAIN, address);
    expect(deposit?.status).toBe("ORPHANED");
    expect(deposit?.confirmedAt).toBeDefined();
    expect(deposit?.orphanedAt).toBeDefined();
    expect(harness.published.map((event) => event.type)).toContain("chain.deposit.orphaned");
  });

  test("the same log seen twice produces one deposit", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({ asset: ASSET, to: address, amount: REQUIRED.amount });
    harness.chain.mine(1);

    await harness.watcher.tick(CHAIN, ASSET);
    await harness.cursors.set(CHAIN, ASSET, 0n); // simulate a crash before the cursor was written
    await harness.watcher.tick(CHAIN, ASSET);

    expect(await harness.deposits.listByAddress(CHAIN, address)).toHaveLength(1);
  });

  test("a transfer arriving after the payment is terminal is recorded but does not fund", async () => {
    const address = await harness.awaitingPayment();
    harness.state.set("clr_1", {
      fundable: false,
      requiredAmount: REQUIRED,
      terminalAt: new Date(NOW),
    });

    harness.chain.transfer({ asset: ASSET, to: address, amount: REQUIRED.amount });
    harness.chain.mine(6);
    await harness.watcher.tick(CHAIN, ASSET);

    expect(await harness.deposits.listByAddress(CHAIN, address)).toHaveLength(1);
    expect(harness.funded).toEqual([]);
  });

  test("the cursor advances even when nothing is being watched", async () => {
    harness.chain.mine(4);
    await harness.watcher.tick(CHAIN, ASSET);

    expect(await harness.cursors.get(CHAIN, ASSET)).toBe(4n);
  });

  test("a scan is capped at the configured block range", async () => {
    await harness.awaitingPayment();
    harness.chain.mine(5);

    const capped = new WalletWatcher({
      client: harness.chain,
      addresses: harness.addresses,
      deposits: harness.deposits,
      cursors: harness.cursors,
      clock: new FixedClock(NOW),
      sink: { fund: async () => {} },
      policy: { depth: 6, reorgWatchWindow: 2 },
      blockRange: 2,
      retentionSeconds: 86_400,
    });

    const result = await capped.tick(CHAIN, ASSET);
    expect(result.scannedFrom).toBe(1n);
    expect(result.scannedTo).toBe(2n);
  });
});
