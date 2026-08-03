/**
 * Balance projection.
 *
 * Balances are always derived from entries, never stored as a mutable number.
 * A repository may cache or aggregate them, but this is the definition.
 */

import { subtract, zero } from "@mayarin/shared";
import {
  type AccountBalance,
  type LedgerAccount,
  type LedgerEntry,
  normalBalanceOf,
} from "./types.ts";

export function computeBalance(
  account: LedgerAccount,
  entries: readonly LedgerEntry[],
): AccountBalance {
  let debits = zero(account.asset);
  let credits = zero(account.asset);

  for (const entry of entries) {
    if (entry.accountId !== account.id) continue;
    if (entry.direction === "DEBIT") {
      debits = { amount: debits.amount + entry.amount.amount, asset: account.asset };
    } else {
      credits = { amount: credits.amount + entry.amount.amount, asset: account.asset };
    }
  }

  const balance =
    normalBalanceOf(account.type) === "DEBIT"
      ? subtract(debits, credits)
      : subtract(credits, debits);

  return {
    accountId: account.id,
    accountCode: account.code,
    asset: account.asset,
    debits,
    credits,
    balance,
  };
}
