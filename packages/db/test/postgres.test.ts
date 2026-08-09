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
 * TEST_DATABASE_URL=postgres://mayarin:mayarin@localhost:5433/mayarin bun test packages/db
 * ```
 *
 * Skipped when `TEST_DATABASE_URL` is not set. The suite truncates every table
 * it touches, so it must never key on `DATABASE_URL`: bun loads the root `.env`
 * for every test run, and that variable points at the development database
 * (#110). `TEST_DATABASE_URL` is set only by hand, so running this suite is an
 * explicit choice.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import type { Merchant } from "@mayarin/auth";
import type { SettlementLog } from "@mayarin/chain";
import { FixedDepositAddressDeriver } from "@mayarin/chain/testing";
import {
  BasisPointsFeePolicy,
  ClearingEngine,
  type ClearingTransaction,
  createClearingTransaction,
  StaticRateProvider,
} from "@mayarin/clearing";
import { LedgerService } from "@mayarin/ledger";
import type { WebhookDelivery, WebhookEndpoint } from "@mayarin/notifications";
import { PaymentIntentService } from "@mayarin/payment-intent";
import { MockSettlementAdapter } from "@mayarin/provider-mock";
import { SettlementAdapterRegistry } from "@mayarin/settlement";
import { ConcurrencyError, FixedClock, generateId, money, RATE_SCALE } from "@mayarin/shared";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/client.ts";
import { listenPaymentChanged, notifyPaymentChanged } from "../src/notify.ts";
import {
  DrizzleMerchantRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository,
} from "../src/repositories/auth.ts";
import {
  DrizzleDepositAddressRepository,
  DrizzleDepositRepository,
  DrizzleSettlementEventRepository,
  DrizzleWatcherCursorRepository,
} from "../src/repositories/chain.ts";
import { DrizzleClearingRepository } from "../src/repositories/clearing.ts";
import { DrizzleLedgerRepository } from "../src/repositories/ledger.ts";
import {
  DrizzleWebhookCursorRepository,
  DrizzleWebhookDeliveryRepository,
  DrizzleWebhookEndpointRepository,
  DrizzleWebhookOutbox,
} from "../src/repositories/notifications.ts";
import { DrizzlePaymentIntentRepository } from "../src/repositories/payment-intent.ts";
import { DrizzleMerchantWalletRepository } from "../src/repositories/wallet.ts";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(TEST_DATABASE_URL === undefined)("Drizzle repositories", () => {
  const handle = createDatabase({ url: TEST_DATABASE_URL as string, maxConnections: 4 });

  /** Polls a condition rather than sleeping a guessed interval. */
  async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for a notification");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");

  const intentRepository = new DrizzlePaymentIntentRepository(handle.db);
  const ledgerRepository = new DrizzleLedgerRepository(handle.db, clock);
  const clearingRepository = new DrizzleClearingRepository(handle.db);

  const intents = new PaymentIntentService({
    repository: intentRepository,
    clock,
    defaults: {
      settlementAsset: "IDRX",
      provider: "mock",
      executionPath: "deposit-match",
      ttlSeconds: 900,
    },
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

  /**
   * Every table this suite writes.
   *
   * `merchants` belongs here and its absence was doing real damage: the suite
   * truncated `users` and left every merchant it had created behind, so each run
   * against a development database deleted the operator's account and added more
   * merchant rows no account owned. That produced orphans far faster than the
   * seed-CLI bug in #100 ever did, and it also destroyed the account a developer
   * had just seeded — which presents as the seed silently not working.
   */
  async function truncateAll(): Promise<void> {
    await handle.db.execute(
      sql`truncate table webhook_deliveries, webhook_endpoints, webhook_cursors, wallet_challenges, merchant_wallets, sessions, users, merchants, chain_deposits, deposit_addresses, settlement_events, watcher_cursors, clearing_events, clearing_transactions, ledger_entries, ledger_transactions, ledger_accounts, payment_intents restart identity cascade`,
    );
  }

  beforeEach(truncateAll);

  afterAll(async () => {
    // Truncating only in `beforeEach` leaves whatever the last test wrote, and
    // `TEST_DATABASE_URL` can point at a database something else also uses. The
    // watcher-cursor test is the expensive one to leave behind: it records
    // block 900, and a cursor outranks `CHAIN_START_BLOCKS`, so the next
    // `bun run e2e` starts 45 million blocks back and never sees the deposit
    // it just made. Clean up after the run as well as before each test.
    await truncateAll();
    await handle.close();
  });

  async function confirmedIntent(idempotencyKey?: string, merchantReference?: string) {
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
      ...(merchantReference === undefined ? {} : { merchantReference }),
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

  test("round-trips the execution path on an intent and its clearing transaction", async () => {
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
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "on-chain-contract",
    });
    const loaded = await intents.getById(created.id);
    expect(loaded.executionPath).toBe("on-chain-contract");

    const { transaction, event } = createClearingTransaction(loaded, clock.now());
    await clearingRepository.insert(transaction, [event]);
    expect((await clearingRepository.findById(transaction.id))?.executionPath).toBe(
      "on-chain-contract",
    );
  });

  test("round-trips the contract lock, so a resumed step never re-signs", async () => {
    const created = await intents.create({
      merchant: {
        id: "ID1020017611473",
        name: "Warung Kopi Mayarin",
        city: "Jakarta",
        countryCode: "ID",
      },
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" },
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "on-chain-contract",
    });
    const { transaction, event } = createClearingTransaction(
      await intents.getById(created.id),
      clock.now(),
    );
    await clearingRepository.insert(transaction, [event]);

    const locked: ClearingTransaction = {
      ...transaction,
      contract: {
        order: {
          intentId: "0xdeadbeef",
          settlementToken: "0xusdc",
          minOut: 3_000_000n,
          fee: 10_000n,
          merchantSafe: "0xmerchant",
          refundTo: "0xpayer",
          deadline: 1_800_000_000n,
          signature: "0xsig",
          signer: "0xsigner",
        },
        payerEstimate: money(704_000_000_000_000n, "ETH"),
        expiresAt: new Date("2026-01-01T00:02:00.000Z"),
      },
      version: transaction.version + 1,
    };
    await clearingRepository.update(locked, transaction.version, []);

    const reloaded = await clearingRepository.findById(transaction.id);
    // Every field the later steps read: the order is reused rather than
    // re-signed, and the indexer resolves a log through `intentId`.
    expect(reloaded?.contract?.order).toEqual(locked.contract?.order);
    expect(reloaded?.contract?.payerEstimate).toEqual(money(704_000_000_000_000n, "ETH"));
    expect(reloaded?.contract?.expiresAt).toEqual(new Date("2026-01-01T00:02:00.000Z"));
    expect(reloaded?.contract?.txHash).toBeUndefined();
  });

  test("round-trips the completion tx hash recorded against a lock", async () => {
    const created = await intents.create({
      merchant: {
        id: "ID1020017611473",
        name: "Warung Kopi Mayarin",
        city: "Jakarta",
        countryCode: "ID",
      },
      amount: money(5_000_000n, "IDR"),
      source: { type: "manual" },
      payment: { asset: "USDC", chain: "base-sepolia" },
      executionPath: "on-chain-contract",
    });
    const { transaction, event } = createClearingTransaction(
      await intents.getById(created.id),
      clock.now(),
    );
    await clearingRepository.insert(transaction, [event]);

    const settled: ClearingTransaction = {
      ...transaction,
      contract: {
        order: {
          intentId: "0xfeedface",
          settlementToken: "0xusdc",
          minOut: 3_000_000n,
          fee: 10_000n,
          merchantSafe: "0xmerchant",
          refundTo: "0xpayer",
          deadline: 1_800_000_000n,
          signature: "0xsig",
          signer: "0xsigner",
        },
        payerEstimate: money(1n, "ETH"),
        expiresAt: new Date("2026-01-01T00:02:00.000Z"),
        txHash: "0xabc123",
      },
      version: transaction.version + 1,
    };
    await clearingRepository.update(settled, transaction.version, []);

    expect((await clearingRepository.findById(transaction.id))?.contract?.txHash).toBe("0xabc123");
  });

  test("a transaction with no contract lock reads back without one", async () => {
    const intent = await confirmedIntent();
    const { transaction, event } = createClearingTransaction(intent, clock.now());
    await clearingRepository.insert(transaction, [event]);

    expect((await clearingRepository.findById(transaction.id))?.contract).toBeUndefined();
  });

  test("a fiat-only intent and its transaction carry no execution path", async () => {
    const intent = await confirmedIntent();
    expect(intent.executionPath).toBeUndefined();

    const { transaction, event } = createClearingTransaction(intent, clock.now());
    await clearingRepository.insert(transaction, [event]);
    expect((await clearingRepository.findById(transaction.id))?.executionPath).toBeUndefined();
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
    expect(reloaded.rate?.scaledRate).toBe(100n * RATE_SCALE);
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

  describe("settlement events", () => {
    const log = (overrides: Partial<SettlementLog> = {}): SettlementLog => ({
      chain: "base-sepolia",
      txHash: "0xstl1",
      logIndex: 0,
      blockNumber: 100n,
      blockHash: "0xblock100",
      intentId: "0xintent1",
      merchantSafe: "0xmerchant",
      settledAmount: 2_990_000n,
      fee: 10_000n,
      refundAmount: 80_000n,
      ...overrides,
    });

    test("records a settlement once however often the range is re-scanned", async () => {
      const settlements = new DrizzleSettlementEventRepository(handle.db);
      const now = clock.now();

      await settlements.record([log()], now);
      await settlements.record([log()], now);

      expect(await settlements.listProbable("base-sepolia", 10)).toHaveLength(1);
    });

    test("a re-scan does not reset a status reclassification already moved on", async () => {
      // `ON CONFLICT DO NOTHING` rather than an update: re-scanning is supposed
      // to be free, not to undo work.
      const settlements = new DrizzleSettlementEventRepository(handle.db);
      const now = clock.now();
      const [recorded] = await settlements.record([log()], now);

      await settlements.updateStatuses([{ id: recorded?.id ?? "", status: "CONFIRMED", at: now }]);
      await settlements.record([log()], now);

      const [reloaded] = await settlements.listProbable("base-sepolia", 10);
      expect(reloaded?.status).toBe("CONFIRMED");
      expect(reloaded?.confirmedAt).toBeDefined();
    });

    test("round-trips the on-chain amounts exactly", async () => {
      const settlements = new DrizzleSettlementEventRepository(handle.db);
      await settlements.record([log()], clock.now());

      const found = await settlements.findByIntentId("0xintent1");
      expect(found?.settledAmount).toBe(2_990_000n);
      expect(found?.fee).toBe(10_000n);
      expect(found?.refundAmount).toBe(80_000n);
      expect(found?.blockNumber).toBe(100n);
    });

    test("lists only confirmed settlements the engine has not been told about", async () => {
      const settlements = new DrizzleSettlementEventRepository(handle.db);
      const now = clock.now();
      const [pending] = await settlements.record([log()], now);
      const [confirmed] = await settlements.record(
        [log({ txHash: "0xstl2", intentId: "0xintent2" })],
        now,
      );
      await settlements.updateStatuses([{ id: confirmed?.id ?? "", status: "CONFIRMED", at: now }]);

      const completable = await settlements.listCompletable("base-sepolia", 10);
      expect(completable.map((event) => event.intentId)).toEqual(["0xintent2"]);
      expect(pending?.status).toBe("PENDING");

      await settlements.markCompleted(confirmed?.id ?? "", now);
      expect(await settlements.listCompletable("base-sepolia", 10)).toHaveLength(0);
    });

    test("excludes orphaned settlements from the probe set", async () => {
      const settlements = new DrizzleSettlementEventRepository(handle.db);
      const now = clock.now();
      const [recorded] = await settlements.record([log()], now);

      await settlements.updateStatuses([{ id: recorded?.id ?? "", status: "ORPHANED", at: now }]);

      expect(await settlements.listProbable("base-sepolia", 10)).toHaveLength(0);
      expect((await settlements.findByIntentId("0xintent1"))?.orphanedAt).toBeDefined();
    });
  });

  test("round-trips a watcher cursor", async () => {
    const repository = new DrizzleWatcherCursorRepository(handle.db);
    await repository.set("base-sepolia", "USDC", 512n);
    await repository.set("base-sepolia", "USDC", 900n);

    expect(await repository.get("base-sepolia", "USDC")).toBe(900n);
  });

  describe("webhook repositories", () => {
    const endpointRepo = new DrizzleWebhookEndpointRepository(handle.db);
    const deliveryRepo = new DrizzleWebhookDeliveryRepository(handle.db);

    async function seedMerchant(id: string): Promise<void> {
      const now = clock.now();
      await new DrizzleMerchantRepository(handle.db).insert({
        id,
        name: "Warung Kopi Mayarin",
        settlementAsset: "IDRX",
        acceptedAssets: [],
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
    }

    function anEndpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
      const now = clock.now();
      return {
        id: generateId("whe", now.getTime()),
        merchantId: "ID1020017611473",
        url: "https://merchant.example/webhooks",
        secret: "whsec_current",
        active: true,
        createdAt: now,
        updatedAt: now,
        ...overrides,
      };
    }

    test("round-trips an endpoint, with and without a previous secret", async () => {
      await seedMerchant("ID1020017611473");
      const bare = anEndpoint();
      const rotated = anEndpoint({
        id: generateId("whe", clock.now().getTime() + 1),
        previousSecret: "whsec_old",
        active: false,
      });
      await endpointRepo.insert(bare);
      await endpointRepo.insert(rotated);

      expect(await endpointRepo.findById(bare.id)).toEqual(bare);
      expect(await endpointRepo.findById(rotated.id)).toEqual(rotated);
      expect(await endpointRepo.listByMerchant("ID1020017611473")).toHaveLength(2);
      expect(await endpointRepo.listActiveByMerchant("ID1020017611473")).toEqual([bare]);
    });

    test("the outbox lists clearing events joined to their payment, after the cursor", async () => {
      await seedMerchant("ID1020017611473");
      const outbox = new DrizzleWebhookOutbox(handle.db);
      const intent = await confirmedIntent();
      await engine.start(intent);

      const events = await outbox.listAfter(undefined, 100);
      expect(events.length).toBeGreaterThanOrEqual(9);
      const [first] = events;
      expect(first?.type).toBe("payment.created");
      expect(first?.merchantId).toBe("ID1020017611473");
      expect(first?.paymentIntentId).toBe(intent.id);
      expect(first?.sequence).toBe(1);
      expect(first?.metadata).toEqual({});
      expect(events[events.length - 1]?.state).toBe("SUCCESS");

      const [head, ...rest] = events;
      const after = await outbox.listAfter(head?.id ?? "", 100);
      expect(after).toEqual(rest);
    });

    test("the outbox carries the merchant's own order id onto every event", async () => {
      await seedMerchant("ID1020017611473");
      const outbox = new DrizzleWebhookOutbox(handle.db);
      await engine.start(await confirmedIntent("order-webhook-ref-1", "INV-1042"));

      const events = await outbox.listAfter(undefined, 100);

      // The reason the channel exists for most integrations: a receiver matches
      // the event to their own order without holding a map from our ids to theirs.
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.merchantReference).toBe("INV-1042");
      }
    });

    test("an intent with no merchant reference carries none", async () => {
      await seedMerchant("ID1020017611473");
      const outbox = new DrizzleWebhookOutbox(handle.db);
      await engine.start(await confirmedIntent("order-webhook-ref-2"));

      const [event] = await outbox.listAfter(undefined, 1);

      // Absent, not an empty string: a receiver filtering on it must be able to
      // tell "no reference" from "the reference is blank".
      expect(event?.merchantReference).toBeUndefined();
    });

    test("a replayed delivery insert maps onto the existing row and counts zero", async () => {
      await seedMerchant("ID1020017611473");
      const outbox = new DrizzleWebhookOutbox(handle.db);
      const endpoint = anEndpoint();
      await endpointRepo.insert(endpoint);
      await engine.start(await confirmedIntent());
      const [event] = await outbox.listAfter(undefined, 1);

      const now = clock.now();
      const delivery: WebhookDelivery = {
        id: generateId("whd", now.getTime()),
        eventId: event?.id ?? "",
        endpointId: endpoint.id,
        merchantId: endpoint.merchantId,
        body: "{}",
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        updatedAt: now,
      };

      expect(await deliveryRepo.insertMany([delivery])).toBe(1);
      expect(
        await deliveryRepo.insertMany([{ ...delivery, id: generateId("whd", now.getTime() + 1) }]),
      ).toBe(0);

      const due = await deliveryRepo.listDue(now, 10);
      expect(due).toHaveLength(1);
      expect(due[0]).toEqual(delivery);

      await deliveryRepo.update({
        ...delivery,
        status: "DELIVERED",
        attempts: 1,
        lastStatusCode: 200,
        deliveredAt: now,
      });
      expect(await deliveryRepo.listDue(now, 10)).toHaveLength(0);
    });

    test("round-trips the dispatcher cursor", async () => {
      const cursors = new DrizzleWebhookCursorRepository(handle.db);
      expect(await cursors.get()).toBeUndefined();

      await cursors.set("evt_01");
      await cursors.set("evt_02");
      expect(await cursors.get()).toBe("evt_02");
    });
  });

  describe("payment change notifications", () => {
    test("a listener on another connection is told once the write commits", async () => {
      const heard: string[] = [];
      const subscription = await listenPaymentChanged(handle.sql, (id) => heard.push(id));

      try {
        const intent = await confirmedIntent("order-notify-0001");
        await engine.start(intent);

        // NOTIFY is delivered asynchronously after commit; this waits for the
        // round trip rather than assuming it already happened.
        await waitFor(() => heard.includes(intent.id));

        expect(heard).toContain(intent.id);
      } finally {
        await subscription.unlisten();
      }
    });

    test("a rolled-back write tells nobody", async () => {
      const heard: string[] = [];
      const subscription = await listenPaymentChanged(handle.sql, (id) => heard.push(id));

      try {
        // Postgres queues a notification until commit and discards it on
        // rollback, which is what stops a listener hearing about a change that
        // did not happen.
        await handle.db
          .transaction(async (tx) => {
            await notifyPaymentChanged(tx, "pi_rolled_back");
            throw new Error("rolled back on purpose");
          })
          .catch(() => undefined);

        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(heard).not.toContain("pi_rolled_back");
      } finally {
        await subscription.unlisten();
      }
    });
  });

  describe("auth repositories", () => {
    test("inserts and finds a merchant", async () => {
      const merchants = new DrizzleMerchantRepository(handle.db);
      const now = clock.now();
      const merchant: Merchant = {
        id: generateId("mrc", now.getTime()),
        name: "Acme",
        settlementAsset: "USDC",
        acceptedAssets: ["ETH", "USDC"],
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      await merchants.insert(merchant);
      expect((await merchants.findById(merchant.id))?.name).toBe("Acme");
      expect((await merchants.list()).length).toBeGreaterThanOrEqual(1);
    });

    test("inserts and finds a user by id and email", async () => {
      const merchants = new DrizzleMerchantRepository(handle.db);
      const users = new DrizzleUserRepository(handle.db);
      const now = clock.now();
      const merchantId = generateId("mrc", now.getTime());
      await merchants.insert({
        id: merchantId,
        name: "Acme",
        settlementAsset: "USDC",
        acceptedAssets: ["ETH", "USDC"],
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      const user = {
        id: generateId("usr", now.getTime()),
        email: "admin@mayarin.local",
        passwordHash: "$argon2id$hashed",
        merchantId,
        permissions: ["payments:read", "admin:access"] as const,
        createdAt: now,
        updatedAt: now,
      };
      await users.insert(user);

      expect((await users.findById(user.id))?.email).toBe("admin@mayarin.local");
      const found = await users.findByEmail("admin@mayarin.local");
      expect(found?.id).toBe(user.id);
      expect(found?.permissions).toEqual(["payments:read", "admin:access"]);
    });

    test("rejects a duplicate email", async () => {
      const merchants = new DrizzleMerchantRepository(handle.db);
      const users = new DrizzleUserRepository(handle.db);
      const now = clock.now();
      const merchantId = generateId("mrc", now.getTime());
      await merchants.insert({
        id: merchantId,
        name: "Acme",
        settlementAsset: "USDC",
        acceptedAssets: ["ETH", "USDC"],
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      const base = {
        email: "dup@mayarin.local",
        passwordHash: "$argon2id$hashed",
        merchantId,
        permissions: ["payments:read"] as const,
        createdAt: now,
        updatedAt: now,
      };
      await users.insert({ ...base, id: generateId("usr", now.getTime()) });
      await expect(
        users.insert({ ...base, id: generateId("usr", now.getTime() + 1) }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
      });
    });

    test("lists users by merchant and touches updatedAt", async () => {
      const merchants = new DrizzleMerchantRepository(handle.db);
      const users = new DrizzleUserRepository(handle.db);
      const now = clock.now();
      const merchantId = generateId("mrc", now.getTime());
      await merchants.insert({
        id: merchantId,
        name: "Acme",
        settlementAsset: "USDC",
        acceptedAssets: ["ETH", "USDC"],
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      const admin = {
        id: generateId("usr", now.getTime()),
        email: "a2@mayarin.local",
        passwordHash: "$argon2id$hashed",
        merchantId,
        permissions: ["payments:read"] as const,
        createdAt: now,
        updatedAt: now,
      };
      await users.insert(admin);

      expect((await users.listByMerchant(merchantId)).length).toBe(1);
      const later = new Date("2026-03-01T00:00:00.000Z");
      await users.touchUpdatedAt(admin.id, later);
      expect((await users.findById(admin.id))?.updatedAt).toEqual(later);
    });

    test("inserts, verifies and revokes a session", async () => {
      const merchants = new DrizzleMerchantRepository(handle.db);
      const userRepo = new DrizzleUserRepository(handle.db);
      const sessionRepo = new DrizzleSessionRepository(handle.db);
      const now = clock.now();
      const merchantId = generateId("mrc", now.getTime());
      await merchants.insert({
        id: merchantId,
        name: "Acme",
        settlementAsset: "USDC",
        acceptedAssets: ["ETH", "USDC"],
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      const userId = generateId("usr", now.getTime());
      await userRepo.insert({
        id: userId,
        email: "s@mayarin.local",
        passwordHash: "$argon2id$hashed",
        merchantId,
        permissions: ["payments:read"] as const,
        createdAt: now,
        updatedAt: now,
      });
      const session = {
        id: generateId("ses", now.getTime()),
        userId,
        csrfToken: "csrf-token",
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        createdAt: now,
      };
      await sessionRepo.insert(session);
      expect((await sessionRepo.findById(session.id))?.userId).toBe(userId);

      const revokedAt = new Date("2026-01-02T00:00:00.000Z");
      await sessionRepo.revoke(session.id, revokedAt);
      expect((await sessionRepo.findById(session.id))?.revokedAt).toEqual(revokedAt);
    });

    test("deleteExpired removes only past sessions", async () => {
      const merchants = new DrizzleMerchantRepository(handle.db);
      const userRepo = new DrizzleUserRepository(handle.db);
      const sessionRepo = new DrizzleSessionRepository(handle.db);
      const now = clock.now();
      const merchantId = generateId("mrc", now.getTime());
      await merchants.insert({
        id: merchantId,
        name: "Acme",
        settlementAsset: "USDC",
        acceptedAssets: ["ETH", "USDC"],
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      const userId = generateId("usr", now.getTime());
      await userRepo.insert({
        id: userId,
        email: "e2@mayarin.local",
        passwordHash: "$argon2id$hashed",
        merchantId,
        permissions: ["payments:read"] as const,
        createdAt: now,
        updatedAt: now,
      });
      const past = {
        id: generateId("ses", now.getTime()),
        userId,
        csrfToken: "t",
        expiresAt: new Date("2025-01-01T00:00:00.000Z"),
        createdAt: now,
      };
      const future = {
        id: generateId("ses", now.getTime() + 1),
        userId,
        csrfToken: "t",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        createdAt: now,
      };
      await sessionRepo.insert(past);
      await sessionRepo.insert(future);

      expect(await sessionRepo.deleteExpired(now)).toBe(1);
      expect(await sessionRepo.findById(past.id)).toBeNull();
      expect(await sessionRepo.findById(future.id)).not.toBeNull();
    });
  });
  describe("merchant wallets", () => {
    /** A merchant to hang wallets off; the table is foreign-keyed to one. */
    async function seedMerchant(): Promise<string> {
      const merchants = new DrizzleMerchantRepository(handle.db);
      const now = clock.now();
      const id = generateId("mrc", now.getTime());
      await merchants.insert({
        id,
        name: "Acme",
        settlementAsset: "USDC",
        acceptedAssets: ["USDC"],
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      return id;
    }

    test("round-trips the signer set a managed wallet was derived from", async () => {
      // All three signer columns or none: a partial derivation cannot re-derive
      // the address, so a resumed provision would compute a different one and
      // deploy a second Safe.
      const wallets = new DrizzleMerchantWalletRepository(handle.db);
      const merchantId = await seedMerchant();
      const now = clock.now();
      const wallet = {
        id: generateId("wlt", now.getTime()),
        merchantId,
        chain: "base-sepolia" as const,
        address: "0x1111111111111111111111111111111111111111",
        provenance: "provisioned" as const,
        managed: {
          ref: "sub-org-1",
          address: "0x2222222222222222222222222222222222222222",
          merchantSigner: "0x3333333333333333333333333333333333333333",
        },
        createdAt: now,
        updatedAt: now,
      };
      await wallets.insert(wallet);

      const found = await wallets.findManaged(merchantId, "base-sepolia");
      expect(found?.managed).toEqual(wallet.managed);
      // Unverified until the deployment is read back, which is what a crashed
      // provision leaves behind and what a resume picks up.
      expect(found?.verifiedAt).toBeUndefined();
    });

    test("round-trips a passkey wallet's key handle", async () => {
      // The handle is how the merchant's browser names the organization it signs
      // in. Losing it on the way through Postgres leaves a wallet nobody can
      // prove control of, and therefore a Safe owner that can never be built.
      const wallets = new DrizzleMerchantWalletRepository(handle.db);
      const merchantId = await seedMerchant();
      const now = clock.now();
      const wallet = {
        id: generateId("wlt", now.getTime()),
        merchantId,
        chain: "base-sepolia" as const,
        address: "0x5555555555555555555555555555555555555555",
        provenance: "passkey" as const,
        keyRef: "merchant-key-sub-org-1",
        createdAt: now,
        updatedAt: now,
      };
      await wallets.insert(wallet);

      const found = await wallets.findByAddress("base-sepolia", wallet.address);
      expect(found?.provenance).toBe("passkey");
      expect(found?.keyRef).toBe("merchant-key-sub-org-1");
      // A merchant-held key is not a managed signer set, and must not read back
      // as one — `findManaged` asks by provenance.
      expect(found?.managed).toBeUndefined();
      expect(await wallets.findManaged(merchantId, "base-sepolia")).toBeNull();
    });

    test("findManaged ignores a linked wallet on the same chain", async () => {
      // Connect-existing lives alongside managed, so "their wallet on this
      // chain" is ambiguous and provenance is what the provisioner asks by.
      const wallets = new DrizzleMerchantWalletRepository(handle.db);
      const merchantId = await seedMerchant();
      const now = clock.now();
      await wallets.insert({
        id: generateId("wlt", now.getTime()),
        merchantId,
        chain: "base-sepolia",
        address: "0x4444444444444444444444444444444444444444",
        provenance: "linked",
        verifiedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      expect(await wallets.findManaged(merchantId, "base-sepolia")).toBeNull();
      expect(await wallets.listByMerchant(merchantId)).toHaveLength(1);
    });

    test("a merchant cannot hold two managed wallets on one chain", async () => {
      // The provisioner checks first, but two concurrent requests both read
      // "none". The database is what makes the second one fail rather than
      // deploy a second smart account.
      const wallets = new DrizzleMerchantWalletRepository(handle.db);
      const merchantId = await seedMerchant();
      const now = clock.now();
      const base = {
        merchantId,
        chain: "base-sepolia" as const,
        provenance: "provisioned" as const,
        createdAt: now,
        updatedAt: now,
      };
      await wallets.insert({
        ...base,
        id: generateId("wlt", now.getTime()),
        address: "0x5555555555555555555555555555555555555555",
      });

      await expect(
        wallets.insert({
          ...base,
          id: generateId("wlt", now.getTime() + 1),
          address: "0x6666666666666666666666666666666666666666",
        }),
      ).rejects.toThrow();
    });

    test("two merchants cannot claim one address", async () => {
      const wallets = new DrizzleMerchantWalletRepository(handle.db);
      const first = await seedMerchant();
      const second = await seedMerchant();
      const now = clock.now();
      const address = "0x7777777777777777777777777777777777777777";
      await wallets.insert({
        id: generateId("wlt", now.getTime()),
        merchantId: first,
        chain: "base-sepolia",
        address,
        provenance: "linked",
        createdAt: now,
        updatedAt: now,
      });

      await expect(
        wallets.insert({
          id: generateId("wlt", now.getTime() + 1),
          merchantId: second,
          chain: "base-sepolia",
          address,
          provenance: "linked",
          createdAt: now,
          updatedAt: now,
        }),
      ).rejects.toThrow();
    });
  });
});
