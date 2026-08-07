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
import type { Merchant } from "@mayarin/auth";
import { FixedDepositAddressDeriver } from "@mayarin/chain/testing";
import {
  BasisPointsFeePolicy,
  ClearingEngine,
  type ClearingTransaction,
  createClearingTransaction,
  StaticRateProvider,
} from "@mayarin/clearing";
import { LedgerService } from "@mayarin/ledger";
import { PaymentIntentService } from "@mayarin/payment-intent";
import { MockSettlementAdapter } from "@mayarin/provider-mock";
import { SettlementAdapterRegistry } from "@mayarin/settlement";
import { ConcurrencyError, FixedClock, generateId, money } from "@mayarin/shared";
import { sql } from "drizzle-orm";
import { createDatabase } from "../src/client.ts";
import {
  DrizzleMerchantRepository,
  DrizzleSessionRepository,
  DrizzleUserRepository,
} from "../src/repositories/auth.ts";
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

  beforeEach(async () => {
    await handle.db.execute(
      sql`truncate table sessions, users, chain_deposits, deposit_addresses, watcher_cursors, clearing_events, clearing_transactions, ledger_entries, ledger_transactions, ledger_accounts, payment_intents restart identity cascade`,
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
});
