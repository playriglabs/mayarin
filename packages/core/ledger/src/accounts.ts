/**
 * Chart of accounts.
 *
 * Accounts are created on demand per asset, so adding a settlement asset does
 * not require a migration. The kinds below are the full set Phase 1 clearing
 * needs — see `docs` in the clearing engine for how a payment moves through
 * them.
 */

import { type AssetCode, ConfigurationError, isAssetCode } from "@mayarr/shared";
import type { AccountType } from "./types.ts";

export interface AccountKindDefinition {
  readonly type: AccountType;
  readonly name: string;
  readonly description: string;
}

export const ACCOUNT_KINDS = {
  /** Settlement assets Mayarr actually holds. */
  TREASURY: {
    type: "ASSET",
    name: "Treasury",
    description: "Settlement assets held by Mayarr and available to settle payments.",
  },
  /** Owed to merchants for cleared payments not yet settled. */
  MERCHANT_PAYABLE: {
    type: "LIABILITY",
    name: "Merchant payable",
    description: "Cleared value owed to merchants, before it is handed to a payment rail.",
  },
  /** Committed to a rail, not yet confirmed as delivered. */
  SETTLEMENT_IN_FLIGHT: {
    type: "LIABILITY",
    name: "Settlement in flight",
    description: "Value handed to a settlement adapter and awaiting confirmation.",
  },
  /** Mayarr's take. */
  FEE_REVENUE: {
    type: "REVENUE",
    name: "Fee revenue",
    description: "Clearing fees retained by Mayarr.",
  },
} as const satisfies Record<string, AccountKindDefinition>;

export type AccountKind = keyof typeof ACCOUNT_KINDS;

export const ACCOUNT_KIND_LIST = Object.keys(ACCOUNT_KINDS) as readonly AccountKind[];

/** Business key for an account: `KIND:ASSET`. */
export function accountCode(kind: AccountKind, asset: AssetCode): string {
  return `${kind}:${asset}`;
}

export interface ParsedAccountCode {
  readonly kind: AccountKind;
  readonly asset: AssetCode;
  readonly definition: AccountKindDefinition;
}

export function parseAccountCode(code: string): ParsedAccountCode {
  const separator = code.indexOf(":");
  const kind = code.slice(0, separator);
  const asset = code.slice(separator + 1);

  if (separator === -1 || !(kind in ACCOUNT_KINDS)) {
    throw new ConfigurationError(`Unknown ledger account kind in code "${code}"`, { code });
  }

  if (!isAssetCode(asset)) {
    throw new ConfigurationError(`Unknown asset in ledger account code "${code}"`, { code, asset });
  }

  return {
    kind: kind as AccountKind,
    asset,
    definition: ACCOUNT_KINDS[kind as AccountKind],
  };
}

export function accountName(kind: AccountKind, asset: AssetCode): string {
  return `${ACCOUNT_KINDS[kind].name} (${asset})`;
}
