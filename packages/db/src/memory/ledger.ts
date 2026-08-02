import {
  ACCOUNT_KINDS,
  type AccountBalance,
  accountCode,
  accountName,
  computeBalance,
  type EnsureAccountSpec,
  type LedgerAccount,
  type LedgerEntry,
  type LedgerRepository,
  type LedgerTransaction,
} from "@mayarr/ledger";
import { type Clock, ConflictError, generateId, NotFoundError, systemClock } from "@mayarr/shared";

/**
 * In-memory ledger repository.
 *
 * Append-only, like the real thing: transactions are never rewritten and
 * balances are always recomputed from entries.
 */
export class InMemoryLedgerRepository implements LedgerRepository {
  readonly #accountsByCode = new Map<string, LedgerAccount>();
  readonly #accountsById = new Map<string, LedgerAccount>();
  readonly #transactions = new Map<string, LedgerTransaction>();
  readonly #byIdempotencyKey = new Map<string, string>();
  readonly #entries: LedgerEntry[] = [];
  readonly #clock: Clock;

  constructor(clock: Clock = systemClock) {
    this.#clock = clock;
  }

  async ensureAccount(spec: EnsureAccountSpec): Promise<LedgerAccount> {
    const code = accountCode(spec.kind, spec.asset);
    const existing = this.#accountsByCode.get(code);
    if (existing !== undefined) return existing;

    const now = this.#clock.now();
    const account: LedgerAccount = {
      id: generateId("lacc", now.getTime()),
      code,
      name: accountName(spec.kind, spec.asset),
      type: ACCOUNT_KINDS[spec.kind].type,
      asset: spec.asset,
      createdAt: now,
    };

    this.#accountsByCode.set(code, account);
    this.#accountsById.set(account.id, account);
    return account;
  }

  async findAccountByCode(code: string): Promise<LedgerAccount | null> {
    return this.#accountsByCode.get(code) ?? null;
  }

  async post(transaction: LedgerTransaction): Promise<void> {
    if (this.#transactions.has(transaction.id)) {
      throw new ConflictError(`Ledger transaction ${transaction.id} already exists`, {
        id: transaction.id,
      });
    }
    if (transaction.idempotencyKey !== undefined) {
      if (this.#byIdempotencyKey.has(transaction.idempotencyKey)) {
        throw new ConflictError(
          `Ledger idempotency key "${transaction.idempotencyKey}" is already in use`,
          { idempotencyKey: transaction.idempotencyKey },
        );
      }
      this.#byIdempotencyKey.set(transaction.idempotencyKey, transaction.id);
    }

    this.#transactions.set(transaction.id, transaction);
    this.#entries.push(...transaction.entries);
  }

  async findTransactionById(id: string): Promise<LedgerTransaction | null> {
    return this.#transactions.get(id) ?? null;
  }

  async findTransactionByIdempotencyKey(key: string): Promise<LedgerTransaction | null> {
    const id = this.#byIdempotencyKey.get(key);
    return id === undefined ? null : (this.#transactions.get(id) ?? null);
  }

  async listTransactionsByReference(reference: string): Promise<LedgerTransaction[]> {
    return [...this.#transactions.values()]
      .filter((transaction) => transaction.reference === reference)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async balanceOf(accountId: string): Promise<AccountBalance> {
    const account = this.#accountsById.get(accountId);
    if (account === undefined) {
      throw new NotFoundError(`Ledger account ${accountId} not found`, { accountId });
    }
    return computeBalance(account, this.#entries);
  }

  /** Every entry ever posted, in insertion order. Test and inspection helper. */
  entries(): readonly LedgerEntry[] {
    return this.#entries;
  }
}
