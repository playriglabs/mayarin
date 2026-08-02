/**
 * Transaction construction and the balance invariant.
 *
 * A posting is only valid if, for every asset it touches, debits equal credits.
 * Cross-asset postings are allowed (an FX or conversion step touches two
 * assets) but each asset must balance on its own — otherwise value would appear
 * on one side of the books and vanish on the other.
 */

import {
  type AssetCode,
  formatMoney,
  generateId,
  isPositive,
  LedgerImbalanceError,
  type Money,
  ValidationError,
  zero,
} from "@mayarr/shared";
import type {
  DraftEntry,
  DraftTransaction,
  LedgerAccount,
  LedgerEntry,
  LedgerTransaction,
} from "./types.ts";

export interface AssetTotals {
  readonly asset: AssetCode;
  readonly debits: Money;
  readonly credits: Money;
}

/** Totals per asset across a set of entries. */
export function totalsByAsset(entries: readonly (DraftEntry | LedgerEntry)[]): AssetTotals[] {
  const totals = new Map<AssetCode, { debits: Money; credits: Money }>();

  for (const entry of entries) {
    const asset = entry.amount.asset;
    const current = totals.get(asset) ?? { debits: zero(asset), credits: zero(asset) };
    if (entry.direction === "DEBIT") {
      totals.set(asset, {
        debits: { amount: current.debits.amount + entry.amount.amount, asset },
        credits: current.credits,
      });
    } else {
      totals.set(asset, {
        debits: current.debits,
        credits: { amount: current.credits.amount + entry.amount.amount, asset },
      });
    }
  }

  return [...totals.entries()].map(([asset, sides]) => ({ asset, ...sides }));
}

/**
 * Enforces the double-entry invariant.
 *
 * Throws `LedgerImbalanceError` — not a validation error — because an unbalanced
 * posting means Mayarr's own logic tried to create or destroy value.
 */
export function assertBalanced(entries: readonly (DraftEntry | LedgerEntry)[]): void {
  if (entries.length < 2) {
    throw new LedgerImbalanceError("A ledger transaction needs at least two entries", {
      entryCount: entries.length,
    });
  }

  for (const entry of entries) {
    if (!isPositive(entry.amount)) {
      throw new ValidationError(
        "Ledger entry amounts must be positive; use direction to express the sign",
        { accountCode: entry.accountCode, amount: formatMoney(entry.amount) },
      );
    }
  }

  for (const { asset, debits, credits } of totalsByAsset(entries)) {
    if (debits.amount !== credits.amount) {
      throw new LedgerImbalanceError(
        `Ledger transaction does not balance in ${asset}: debits ${formatMoney(debits)} vs credits ${formatMoney(credits)}`,
        { asset, debits: debits.amount.toString(), credits: credits.amount.toString() },
      );
    }
  }
}

/**
 * Materializes a draft into a transaction with ids.
 *
 * `accounts` maps account code to the resolved account; every draft entry must
 * be covered, and the entry's asset must match the account's.
 */
export function buildTransaction(
  draft: DraftTransaction,
  accounts: ReadonlyMap<string, LedgerAccount>,
  now: Date,
): LedgerTransaction {
  assertBalanced(draft.entries);

  const createdAt = new Date(now);
  const transactionId = generateId("ltxn", createdAt.getTime());

  const entries: LedgerEntry[] = draft.entries.map((entry) => {
    const account = accounts.get(entry.accountCode);
    if (account === undefined) {
      throw new ValidationError(`Unresolved ledger account "${entry.accountCode}"`, {
        accountCode: entry.accountCode,
      });
    }
    if (account.asset !== entry.amount.asset) {
      throw new ValidationError(
        `Entry asset ${entry.amount.asset} does not match account ${account.code} (${account.asset})`,
        { accountCode: account.code, accountAsset: account.asset, entryAsset: entry.amount.asset },
      );
    }

    return {
      id: generateId("lent", createdAt.getTime()),
      transactionId,
      accountId: account.id,
      accountCode: account.code,
      direction: entry.direction,
      amount: entry.amount,
      createdAt,
    };
  });

  return {
    id: transactionId,
    description: draft.description,
    ...(draft.reference === undefined ? {} : { reference: draft.reference }),
    ...(draft.idempotencyKey === undefined ? {} : { idempotencyKey: draft.idempotencyKey }),
    entries,
    createdAt,
  };
}
