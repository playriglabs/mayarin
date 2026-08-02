import {
  ACCOUNT_KINDS,
  type AccountBalance,
  type AccountType,
  accountCode,
  accountName,
  type EnsureAccountSpec,
  type EntryDirection,
  type LedgerAccount,
  type LedgerEntry,
  type LedgerRepository,
  type LedgerTransaction,
  normalBalanceOf,
} from "@mayarr/ledger";
import { type Clock, generateId, NotFoundError, systemClock, zero } from "@mayarr/shared";
import { asc, eq } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, runInTransaction, toAsset, toMoney } from "../mapping.ts";
import { ledgerAccounts, ledgerEntries, ledgerTransactions } from "../schema.ts";

type AccountRow = typeof ledgerAccounts.$inferSelect;
type TransactionRow = typeof ledgerTransactions.$inferSelect;
type EntryRow = typeof ledgerEntries.$inferSelect;

export class DrizzleLedgerRepository implements LedgerRepository {
  readonly #db: Executor;
  readonly #clock: Clock;

  constructor(db: Executor, clock: Clock = systemClock) {
    this.#db = db;
    this.#clock = clock;
  }

  /**
   * Creates the account if needed.
   *
   * `onConflictDoNothing` plus a re-read makes this safe under concurrency: two
   * requests clearing the first ever IDRX payment cannot create two treasuries.
   */
  async ensureAccount(spec: EnsureAccountSpec): Promise<LedgerAccount> {
    const code = accountCode(spec.kind, spec.asset);
    const existing = await this.findAccountByCode(code);
    if (existing !== null) return existing;

    const now = this.#clock.now();
    await this.#db
      .insert(ledgerAccounts)
      .values({
        id: generateId("lacc", now.getTime()),
        code,
        name: accountName(spec.kind, spec.asset),
        type: ACCOUNT_KINDS[spec.kind].type,
        asset: spec.asset,
        createdAt: now,
      })
      .onConflictDoNothing({ target: ledgerAccounts.code });

    const account = await this.findAccountByCode(code);
    if (account === null) {
      throw new NotFoundError(`Ledger account ${code} could not be created`, { code });
    }
    return account;
  }

  async findAccountByCode(code: string): Promise<LedgerAccount | null> {
    const [row] = await this.#db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.code, code))
      .limit(1);
    return row === undefined ? null : toAccount(row);
  }

  /** Header and entries land together or not at all. */
  async post(transaction: LedgerTransaction): Promise<void> {
    await runInTransaction(this.#db, async (tx) => {
      await tx.insert(ledgerTransactions).values({
        id: transaction.id,
        description: transaction.description,
        reference: transaction.reference ?? null,
        idempotencyKey: transaction.idempotencyKey ?? null,
        createdAt: transaction.createdAt,
      });

      await tx.insert(ledgerEntries).values(
        transaction.entries.map((entry) => ({
          id: entry.id,
          transactionId: entry.transactionId,
          accountId: entry.accountId,
          accountCode: entry.accountCode,
          direction: entry.direction,
          amount: entry.amount.amount.toString(),
          asset: entry.amount.asset,
          createdAt: entry.createdAt,
        })),
      );
    });
  }

  async findTransactionById(id: string): Promise<LedgerTransaction | null> {
    const [row] = await this.#db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.id, id))
      .limit(1);
    return row === undefined ? null : this.#hydrate(row);
  }

  async findTransactionByIdempotencyKey(key: string): Promise<LedgerTransaction | null> {
    const [row] = await this.#db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.idempotencyKey, key))
      .limit(1);
    return row === undefined ? null : this.#hydrate(row);
  }

  async listTransactionsByReference(reference: string): Promise<LedgerTransaction[]> {
    const rows = await this.#db
      .select()
      .from(ledgerTransactions)
      .where(eq(ledgerTransactions.reference, reference))
      .orderBy(asc(ledgerTransactions.id));
    return Promise.all(rows.map((row) => this.#hydrate(row)));
  }

  /**
   * Balances are summed from entries rather than read from a cached column, so
   * they cannot drift from the journal that produced them.
   */
  async balanceOf(accountId: string): Promise<AccountBalance> {
    const [accountRow] = await this.#db
      .select()
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, accountId))
      .limit(1);

    if (accountRow === undefined) {
      throw new NotFoundError(`Ledger account ${accountId} not found`, { accountId });
    }

    const account = toAccount(accountRow);
    const rows = await this.#db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.accountId, accountId));

    let debits = zero(account.asset);
    let credits = zero(account.asset);
    for (const row of rows) {
      const amount = BigInt(row.amount);
      if (row.direction === "DEBIT")
        debits = { amount: debits.amount + amount, asset: account.asset };
      else credits = { amount: credits.amount + amount, asset: account.asset };
    }

    const balance =
      normalBalanceOf(account.type) === "DEBIT"
        ? { amount: debits.amount - credits.amount, asset: account.asset }
        : { amount: credits.amount - debits.amount, asset: account.asset };

    return { accountId, accountCode: account.code, asset: account.asset, debits, credits, balance };
  }

  async #hydrate(row: TransactionRow): Promise<LedgerTransaction> {
    const entries = await this.#db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.transactionId, row.id))
      .orderBy(asc(ledgerEntries.id));

    return {
      id: row.id,
      description: row.description,
      ...present("reference", row.reference),
      ...present("idempotencyKey", row.idempotencyKey),
      entries: entries.map(toEntry),
      createdAt: row.createdAt,
    };
  }
}

function toAccount(row: AccountRow): LedgerAccount {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type as AccountType,
    asset: toAsset(row.asset),
    createdAt: row.createdAt,
  };
}

function toEntry(row: EntryRow): LedgerEntry {
  return {
    id: row.id,
    transactionId: row.transactionId,
    accountId: row.accountId,
    accountCode: row.accountCode,
    direction: row.direction as EntryDirection,
    amount: toMoney(row.amount, row.asset),
    createdAt: row.createdAt,
  };
}
