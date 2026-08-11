import { beforeEach, describe, expect, test } from "bun:test";
import { type DomainEvent, FixedClock, InMemoryEventBus, money } from "@mayarin/shared";
import { WalletWatcher } from "../src/watcher.ts";
import {
  FakeChainClient,
  FixedDepositAddressDeriver,
  InMemoryDepositAddressRepository,
  InMemoryDepositRepository,
  InMemoryWatcherCursorRepository,
  type WatchedTransactionState,
} from "../testing/index.ts";

const CHAIN = "base-sepolia" as const;
const ASSET = "USDC" as const;
const NOW = "2026-01-01T00:00:00.000Z";
/** 3.21 USDC, six decimals. */
const REQUIRED = money(3_210_000n, ASSET);
const NATIVE = "ETH" as const;
/** 0.00416667 ETH — what $12.50 comes to, rounded to what a payer can type. */
const NATIVE_REQUIRED = money(4_166_670_000_000_000n, NATIVE);

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

  /**
   * A second watcher over the chain's own currency, sharing every repository.
   *
   * Native is the only asset that gets the balance reconciliation, so it needs
   * its own watcher to exercise: an ERC-20 emits a `Transfer` log however it
   * moves and is already covered by the scan.
   */
  const nativeWatcher = new WalletWatcher({
    client: chain,
    addresses,
    deposits,
    cursors,
    clock,
    events,
    sink: {
      fund: async (clearingTransactionId) => {
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
    nativeAssets: { [CHAIN]: NATIVE },
  });

  /** Registers a payment awaiting `NATIVE_REQUIRED` in the chain's own currency. */
  async function awaitingNativePayment(id = "clr_native"): Promise<string> {
    state.set(id, { fundable: true, requiredAmount: NATIVE_REQUIRED });
    const allocated = await addresses.allocate({
      clearingTransactionId: id,
      chain: CHAIN,
      asset: NATIVE,
      deriver,
      now: clock.now(),
    });
    return allocated.address;
  }

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
    nativeWatcher,
    awaitingNativePayment,
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

  test("a deposit first seen past the reorg-watch window still funds", async () => {
    // depth 6 x window 2 = 12. A deposit buried deeper than that before the
    // watcher ever sees it — catch-up after downtime, a wide block range, or a
    // tick interval longer than the window — used to be dropped by the
    // reclassify filter and stay PENDING forever, so the payment never funded.
    const address = await harness.awaitingPayment();
    harness.chain.transfer({ asset: ASSET, to: address, amount: REQUIRED.amount });
    harness.chain.mine(30);

    const result = await harness.watcher.tick(CHAIN, ASSET);

    expect(result.recorded).toBe(1);
    expect(result.confirmed).toBe(1);
    expect(harness.funded).toEqual(["clr_1"]);
  });

  test("a deposit past the window is not re-confirmed on a later pass", async () => {
    const address = await harness.awaitingPayment();
    harness.chain.transfer({ asset: ASSET, to: address, amount: REQUIRED.amount });
    harness.chain.mine(30);

    await harness.watcher.tick(CHAIN, ASSET);
    harness.chain.mine(5);
    const second = await harness.watcher.tick(CHAIN, ASSET);

    // Already CONFIRMED, so it is final and left alone rather than re-probed.
    expect(second.confirmed).toBe(0);
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

  describe("native value that no block body shows", () => {
    test("a native payment beyond the scan range is reconciled and closes the downtime gap", async () => {
      const address = await harness.awaitingNativePayment();
      // The watcher was down for 2,000 blocks. The payment lands just beyond
      // the native block-body range, where replaying history would not see it
      // on this pass.
      harness.chain.mine(2_000);
      harness.chain.transfer({ asset: NATIVE, to: address, amount: NATIVE_REQUIRED.amount });
      harness.chain.mine(8);

      const result = await harness.nativeWatcher.tick(CHAIN, NATIVE);

      // Balance reconciliation accounts through head - depth, leaving only the
      // finality window for the ordinary scanner on the next pass.
      expect(result.scannedTo).toBe(result.headNumber - 6n);
      expect(result.recorded).toBe(1);
      expect(harness.funded).toEqual(["clr_native"]);
      expect(await harness.cursors.get(CHAIN, NATIVE)).toBe(result.headNumber - 6n);
    });

    test("an internal transfer is found by balance and funds the payment", async () => {
      const address = await harness.awaitingNativePayment();
      // Paid by a smart-contract wallet: the value is at the address and no
      // transaction in any block is addressed to it. This is what the block
      // scan is structurally unable to see.
      harness.chain.creditInternally(address, NATIVE_REQUIRED.amount);
      harness.chain.mine(8);

      const result = await harness.nativeWatcher.tick(CHAIN, NATIVE);

      expect(result.recorded).toBe(1);
      expect(harness.funded).toEqual(["clr_native"]);
    });

    test("value already seen as a transfer is not counted twice", async () => {
      const address = await harness.awaitingNativePayment();
      // The same value, arriving the ordinary way. The balance reconciliation
      // runs in the same tick and must find nothing left to account for.
      harness.chain.transfer({ asset: NATIVE, to: address, amount: NATIVE_REQUIRED.amount });
      harness.chain.mine(8);

      await harness.nativeWatcher.tick(CHAIN, NATIVE);

      const recorded = await harness.deposits.listByAddress(CHAIN, address);
      expect(recorded).toHaveLength(1);
      expect(recorded[0]?.amount.amount).toBe(NATIVE_REQUIRED.amount);
    });

    test("only the unaccounted part is recorded when both paths see value", async () => {
      const address = await harness.awaitingNativePayment();
      const half = NATIVE_REQUIRED.amount / 2n;
      harness.chain.transfer({ asset: NATIVE, to: address, amount: half });
      harness.chain.creditInternally(address, NATIVE_REQUIRED.amount - half);
      harness.chain.mine(8);

      await harness.nativeWatcher.tick(CHAIN, NATIVE);

      const recorded = await harness.deposits.listByAddress(CHAIN, address);
      const total = recorded.reduce((sum, deposit) => sum + deposit.amount.amount, 0n);
      expect(total).toBe(NATIVE_REQUIRED.amount);
    });

    test("a second tick records nothing new", async () => {
      const address = await harness.awaitingNativePayment();
      harness.chain.creditInternally(address, NATIVE_REQUIRED.amount);
      harness.chain.mine(8);

      await harness.nativeWatcher.tick(CHAIN, NATIVE);
      const second = await harness.nativeWatcher.tick(CHAIN, NATIVE);

      // Keyed on the address and the height observed, so re-reading the same
      // block is idempotent rather than a second deposit.
      expect(second.recorded).toBe(0);
    });

    test("an ERC-20 payment gets no balance reconciliation", async () => {
      const address = await harness.awaitingPayment();
      harness.chain.creditInternally(address, REQUIRED.amount);
      harness.chain.mine(8);

      // A token emits a Transfer log however it moves, so `eth_getLogs` already
      // sees an internal call and a balance would add nothing.
      const result = await harness.watcher.tick(CHAIN, ASSET);
      expect(result.recorded).toBe(0);
      expect(harness.funded).toEqual([]);
    });
  });
});
