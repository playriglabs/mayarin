import type { AssetCode } from "@mayarr/shared";
import type { AccountKind } from "./accounts.ts";
import type { AccountBalance, LedgerAccount, LedgerTransaction } from "./types.ts";

export interface EnsureAccountSpec {
  readonly kind: AccountKind;
  readonly asset: AssetCode;
}

/**
 * Persistence port for the ledger.
 *
 * `post` must be atomic: either every entry of a transaction lands or none
 * does. There is deliberately no update or delete — the ledger is append-only.
 */
export interface LedgerRepository {
  /** Creates the account if it does not exist yet, and returns it either way. */
  ensureAccount(spec: EnsureAccountSpec): Promise<LedgerAccount>;
  findAccountByCode(code: string): Promise<LedgerAccount | null>;
  post(transaction: LedgerTransaction): Promise<void>;
  findTransactionById(id: string): Promise<LedgerTransaction | null>;
  findTransactionByIdempotencyKey(key: string): Promise<LedgerTransaction | null>;
  listTransactionsByReference(reference: string): Promise<LedgerTransaction[]>;
  balanceOf(accountId: string): Promise<AccountBalance>;
}
