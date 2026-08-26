import type { AssetCode, Money } from "@mayarin/shared";

export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type EntryDirection = "DEBIT" | "CREDIT";

/**
 * The side that increases an account.
 *
 * Assets and expenses grow on the debit side; liabilities, equity and revenue
 * grow on the credit side.
 */
export function normalBalanceOf(type: AccountType): EntryDirection {
  return type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT";
}

/**
 * A ledger account.
 *
 * Accounts are single-asset by design: a balance is only meaningful in one unit
 * of account, and mixing them is how "we hold 5,000 of something" bugs happen.
 */
export interface LedgerAccount {
  readonly id: string;
  /** Stable business key, `KIND:ASSET` — e.g. `TREASURY:USDC`. */
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly asset: AssetCode;
  readonly createdAt: Date;
}

/**
 * One side of a posting. Amounts are always positive; `direction` carries the
 * sign, which is what makes the balance invariant checkable.
 */
export interface LedgerEntry {
  readonly id: string;
  readonly transactionId: string;
  readonly accountId: string;
  readonly accountCode: string;
  readonly direction: EntryDirection;
  readonly amount: Money;
  readonly createdAt: Date;
}

/**
 * An atomic, balanced, append-only set of entries.
 *
 * Nothing updates or deletes a transaction. A correction is a new transaction
 * that reverses the original.
 */
export interface LedgerTransaction {
  readonly id: string;
  readonly description: string;
  /** Domain object this posting records, e.g. a clearing transaction id. */
  readonly reference?: string;
  readonly idempotencyKey?: string;
  readonly entries: readonly LedgerEntry[];
  readonly createdAt: Date;
}

/** An entry before it is posted: account by business key, no ids yet. */
export interface DraftEntry {
  readonly accountCode: string;
  readonly direction: EntryDirection;
  readonly amount: Money;
}

export interface DraftTransaction {
  readonly description: string;
  readonly reference?: string;
  /**
   * Makes a posting replay-safe. The clearing engine derives it from the step
   * being recorded, so a retried step cannot double-post.
   */
  readonly idempotencyKey?: string;
  readonly entries: readonly DraftEntry[];
}

/** Aggregated position of one account. */
export interface AccountBalance {
  readonly accountId: string;
  readonly accountCode: string;
  readonly asset: AssetCode;
  readonly debits: Money;
  readonly credits: Money;
  /** Signed by the account's normal balance: positive means "as expected". */
  readonly balance: Money;
}
