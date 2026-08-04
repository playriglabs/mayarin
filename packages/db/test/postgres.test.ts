/**
 * Postgres integration tests.
 *
 * Runs the full clearing flow against the real Drizzle repositories, so the
 * adapters are proven against the same behaviour the in-memory ones assert.
 *
 * Requires a migrated database:
 *
 * ```
 * bun run db:up && bun run db:migrate
 * DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin bun test packages/db
 * ```
 *
 * Skipped when `DATABASE_URL` is not set.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedDepositAddressDeriver } from "@mayarin/chain/testing";
import {
  BasisPointsFeePolicy,
  ClearingEngine,
  createClearingTransaction,
  StaticRateProvider,
} from "@mayarin/clearing";
import { LedgerService } from "@mayarin/ledger";
import { PaymentIntentService } from "@mayarin/payment-intent";
import { MockSettlementAdapter } from "@mayarin/provider-mock";
import { SettlementAdapterRegistry } from "@mayarin/settlement";
import { ConcurrencyError, FixedClock, money } from "@mayarin/shared";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/client.ts";
import {
  DrizzleDepositAddressRepository,
  DrizzleDepositRepository,
  DrizzleWatcherCursorRepository,
} from "../src/repositories/chain.ts";
import { DrizzleClearingRepository } from "../src/repositories/clearing.ts";
import { DrizzleLedgerRepository } from "../src/repositories/ledger.ts";
import { DrizzlePaymentIntentRepository } from "../src/repositories/payment-intent.ts";

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined)("Drizzle repositories", () => {
  const handle = createDatabase({ url: DATABASE_URL as string, maxConnections: 4 });
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");

  const intentRepository = new DrizzlePaymentIntentRepository(handle.db);
  const ledgerRepository = new DrizzleLedgerRepository(handle.db, clock);
  const clearingRepository = new DrizzleClearingRepository(handle.db);

  const intents = new PaymentIntentService({
    repository: intentRepository,
    clock,
    defaults: { settlementAsset: "IDRX", provider: "mock", ttlSeconds: 900 },
  });
  const ledger = new LedgerService({ repository: ledgerRepository, clock });
  const adapter = new MockSettlementAdapter({ clock });

  const engine = new ClearingEngine({
    repository: clearingRepository,
    intents,
    ledger,
    adapters: new SettlementAdapterRegistry([adapter]),
    rates: new StaticRateProvider({ "IDR/IDRX": 100n }),
    fees: new BasisPointsFeePolicy(50),
    clock,
    autoConfirmAssetReceipt: true,
  });

  beforeEach(async () => {
    await handle.db.execute(
      sql`truncate table chain_deposits, deposit_addresses, watcher_cursors, clearing_events, clearing_transactions, ledger_entries, ledger_transactions, ledger_accounts, payment_intents restart identity cascade`,
    );
  });

  afterAll(async () => {
    await handle.close();
  });

  async function confirmedIntent(idempotencyKey?: string) {
    const created = await intents.create({
      merchant: {
        id: "ID1020017611473",
        name: "Warung Kopi Mayarin",
        city: "Jakarta",
        countryCode: "ID",
        categoryCode: "5411",
      },
      amount: money(5_000_000n, "IDR"),
      source: { type: "qr", scheme: "QRIS", payload: "00020101021226..." },
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });
    return intents.confirm(created.id);
  }

  test("round-trips a payment intent", async () => {
    const intent = await confirmedIntent("order-round-trip-0001");
    const loaded = await intents.getById(intent.id);

    expect(loaded).toEqual(intent);
    expect(loaded.amount).toEqual(money(5_000_000n, "IDR"));
    expect(loaded.source).toEqual({ type: "qr", scheme: "QRIS", payload: "00020101021226..." });
    expect(loaded.merchant.categoryCode).toBe("5411");
  });

  test("enforces optimistic locking", async () => {
    const intent = await confirmedIntent();
    await intents.markProcessing(intent, "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V3");

    // Second writer still holds the stale version it read.
    await expect(intents.markProcessing(intent, "clr_01J8Z3K4M5N6P7Q8R9S0T1U2V4")).rejects.toThrow(
      ConcurrencyError,
    );
  });

  test("returns the original intent when an idempotency key is replayed", async () => {
    const first = await confirmedIntent("order-idempotent-0001");
    const replay = await intents.create({
      merchant: {
        id: "ID1020017611473",
        name: "Warung Kopi Mayarin",
        city: "Jakarta",
        countryCode: "ID",
        categoryCode: "5411",
      },
      amount: money(5_000_000n, "IDR"),
      source: { type: "qr", scheme: "QRIS", payload: "00020101021226..." },
      idempotencyKey: "order-idempotent-0001",
    });

    expect(replay.id).toBe(first.id);
  });

  test("clears a payment end to end", async () => {
    const intent = await confirmedIntent();
    const transaction = await engine.start(intent);

    expect(transaction.state).toBe("SUCCESS");
    expect(transaction.settlementAmount).toEqual(money(5_000_000n, "IDRX"));
    expect(transaction.fee).toEqual(money(25_000n, "IDRX"));
    expect(transaction.netAmount).toEqual(money(4_975_000n, "IDRX"));
    expect((await intents.getById(intent.id)).status).toBe("COMPLETED");
  });

  test("persists the locked rate and the full event history", async () => {
    const transaction = await engine.start(await confirmedIntent());

    const reloaded = await engine.getById(transaction.id);
    expect(reloaded.rate?.minorUnitsPerWholeUnit).toBe(100n);
    expect(reloaded.rate?.from).toBe("IDR");
    expect(reloaded.rate?.to).toBe("IDRX");

    const history = await engine.history(transaction.id);
    expect(history.map((event) => event.toState)).toEqual([
      "CREATED",
      "QR_PARSED",
      "PRICE_LOCKED",
      "PAYMENT_PENDING",
      "ASSET_RECEIVED",
      "CLEARING",
      "SETTLING",
      "SETTLED",
      "SUCCESS",
    ]);
  });

  test("leaves balanced, correct ledger balances", async () => {
    await engine.start(await confirmedIntent());

    expect((await ledger.balance("TREASURY", "IDRX")).balance).toEqual(money(25_000n, "IDRX"));
    expect((await ledger.balance("FEE_REVENUE", "IDRX")).balance).toEqual(money(25_000n, "IDRX"));
    expect((await ledger.balance("MERCHANT_PAYABLE", "IDRX")).balance).toEqual(money(0n, "IDRX"));
    expect((await ledger.balance("SETTLEMENT_IN_FLIGHT", "IDRX")).balance).toEqual(
      money(0n, "IDRX"),
    );
  });

  test("posts every clearing step exactly once", async () => {
    const transaction = await engine.start(await confirmedIntent());
    const postings = await ledger.transactionsFor(transaction.id);

    expect(postings).toHaveLength(3);
    expect(postings.flatMap((posting) => posting.entries)).toHaveLength(7);

    // Replaying the whole flow must not add a fourth posting.
    await engine.resume(transaction.id);
    expect(await ledger.transactionsFor(transaction.id)).toHaveLength(3);
  });

  test("recovers a transaction left mid-flight", async () => {
    const pendingAdapter = new MockSettlementAdapter({ clock, behaviour: "pending" });
    const pendingEngine = new ClearingEngine({
      repository: clearingRepository,
      intents,
      ledger,
      adapters: new SettlementAdapterRegistry([pendingAdapter]),
      rates: new StaticRateProvider({ "IDR/IDRX": 100n }),
      fees: new BasisPointsFeePolicy(50),
      clock,
      autoConfirmAssetReceipt: true,
    });

    const settling = await pendingEngine.start(await confirmedIntent());
    expect(settling.state).toBe("SETTLING");

    expect(await pendingEngine.resumeStuck()).toHaveLength(1);

    pendingAdapter.complete(settling.providerReference as string);
    const [recovered] = await pendingEngine.resumeStuck();
    expect(recovered?.transaction.state).toBe("SUCCESS");
  });

  /** Inserts an intent and a CREATED clearing transaction, returning the transaction id. */
  async function seedClearingTransaction(): Promise<string> {
    const intent = await confirmedIntent();
    const { transaction, event } = createClearingTransaction(intent, clock.now());
    await clearingRepository.insert(transaction, [event]);
    return transaction.id;
  }

  test("allocates one deposit address per clearing transaction", async () => {
    const repository = new DrizzleDepositAddressRepository(handle.db);
    const deriver = new FixedDepositAddressDeriver();
    const transactionId = await seedClearingTransaction();

    const first = await repository.allocate({
      clearingTransactionId: transactionId,
      chain: "base-sepolia",
      asset: "USDC",
      deriver,
      now: new Date(),
    });
    const again = await repository.allocate({
      clearingTransactionId: transactionId,
      chain: "base-sepolia",
      asset: "USDC",
      deriver,
      now: new Date(),
    });

    expect(again.id).toBe(first.id);
    expect(again.address).toBe(first.address);
  });

  test("records a transfer once however often it is seen", async () => {
    const repository = new DrizzleDepositRepository(handle.db);
    const log = {
      chain: "base-sepolia",
      asset: "USDC",
      txHash: `0x${Date.now().toString(16)}`,
      logIndex: 0,
      blockNumber: 100n,
      blockHash: "0xb100",
      from: "0xfrom",
      to: "0xdeadbeef",
      amount: 1_000_000n,
    } as const;

    await repository.record([log], new Date());
    await repository.record([log], new Date());

    const stored = await repository.listByAddress("base-sepolia", "0xdeadbeef");
    expect(stored).toHaveLength(1);
  });

  test("round-trips a watcher cursor", async () => {
    const repository = new DrizzleWatcherCursorRepository(handle.db);
    await repository.set("base-sepolia", "USDC", 512n);
    await repository.set("base-sepolia", "USDC", 900n);

    expect(await repository.get("base-sepolia", "USDC")).toBe(900n);
  });
});
