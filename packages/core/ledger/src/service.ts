/**
 * Ledger application service.
 *
 * The only way value is recorded in Mayarr. Callers describe a posting in
 * business terms (account kind + asset) and the service resolves accounts,
 * enforces the balance invariant, and appends the transaction.
 */

import type { AssetCode, Clock, Money } from "@mayarr/shared";
import { type AccountKind, accountCode, parseAccountCode } from "./accounts.ts";
import type { LedgerRepository } from "./repository.ts";
import { buildTransaction } from "./transaction.ts";
import type {
  AccountBalance,
  DraftEntry,
  DraftTransaction,
  EntryDirection,
  LedgerAccount,
  LedgerTransaction,
} from "./types.ts";

export interface LedgerServiceOptions {
  readonly repository: LedgerRepository;
  readonly clock: Clock;
}

export class LedgerService {
  readonly #repository: LedgerRepository;
  readonly #clock: Clock;

  constructor(options: LedgerServiceOptions) {
    this.#repository = options.repository;
    this.#clock = options.clock;
  }

  /**
   * Appends a balanced transaction.
   *
   * With an idempotency key, a replay returns the transaction that was already
   * posted instead of double-recording it — the property the clearing engine
   * relies on to be safely resumable.
   */
  async post(draft: DraftTransaction): Promise<LedgerTransaction> {
    if (draft.idempotencyKey !== undefined) {
      const existing = await this.#repository.findTransactionByIdempotencyKey(draft.idempotencyKey);
      if (existing !== null) return existing;
    }

    const accounts = await this.#resolveAccounts(draft.entries);
    const transaction = buildTransaction(draft, accounts, this.#clock.now());
    await this.#repository.post(transaction);
    return transaction;
  }

  async account(kind: AccountKind, asset: AssetCode): Promise<LedgerAccount> {
    return this.#repository.ensureAccount({ kind, asset });
  }

  async balance(kind: AccountKind, asset: AssetCode): Promise<AccountBalance> {
    const account = await this.account(kind, asset);
    return this.#repository.balanceOf(account.id);
  }

  /** Every posting recorded against a domain object, in creation order. */
  async transactionsFor(reference: string): Promise<LedgerTransaction[]> {
    return this.#repository.listTransactionsByReference(reference);
  }

  async #resolveAccounts(
    entries: readonly DraftEntry[],
  ): Promise<ReadonlyMap<string, LedgerAccount>> {
    const codes = [...new Set(entries.map((entry) => entry.accountCode))];
    const resolved = await Promise.all(
      codes.map(async (code) => {
        const { kind, asset } = parseAccountCode(code);
        return [code, await this.#repository.ensureAccount({ kind, asset })] as const;
      }),
    );
    return new Map(resolved);
  }
}

/** Builds one side of a posting in business terms. */
export function entry(direction: EntryDirection, kind: AccountKind, amount: Money): DraftEntry {
  return { direction, accountCode: accountCode(kind, amount.asset), amount };
}

export function debit(kind: AccountKind, amount: Money): DraftEntry {
  return entry("DEBIT", kind, amount);
}

export function credit(kind: AccountKind, amount: Money): DraftEntry {
  return entry("CREDIT", kind, amount);
}
