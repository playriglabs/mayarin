/**
 * Chart of accounts.
 *
 * Accounts are created on demand per asset, so adding a settlement asset does
 * not require a migration. The kinds below are the full set Phase 1 clearing
 * needs — see `docs` in the clearing engine for how a payment moves through
 * them.
 */

import { type AssetCode, ConfigurationError, isAssetCode } from "@mayarin/shared";
import type { AccountType } from "./types.ts";

export interface AccountKindDefinition {
  readonly type: AccountType;
  readonly name: string;
  readonly description: string;
}

export const ACCOUNT_KINDS = {
  /** Settlement assets Mayarin actually holds. */
  TREASURY: {
    type: "ASSET",
    name: "Treasury",
    description: "Settlement assets held by Mayarin and available to settle payments.",
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
  /** Mayarin's take. */
  FEE_REVENUE: {
    type: "REVENUE",
    name: "Fee revenue",
    description: "Clearing fees retained by Mayarin.",
  },
  /** Stablecoin balances credited to merchants, withdrawable on-chain in Phase 4. */
  MERCHANT_HOLDING: {
    type: "LIABILITY",
    name: "Merchant holding",
    description:
      "Stablecoin balances credited to merchants by an internal settlement, withdrawable on-chain in Phase 4.",
  },

  // ---------------------------------------------------------------------
  // The deposit path's intermediate position.
  //
  // On the contract path receive/swap/settle are one atomic transaction, so
  // no intermediate position exists to represent. On the deposit path the
  // payer's asset sits at a deposit address until the executor converts it,
  // and between those two moments `TREASURY` — "settlement assets held by
  // Mayarin" — is not what is held.
  // ---------------------------------------------------------------------

  /** The payer's asset, received and not yet converted. Denominated in the payer's asset, never the settlement asset. */
  PAYER_ASSET_HELD: {
    type: "ASSET",
    name: "Payer asset held",
    description:
      "The payer's asset received at a deposit address and not yet swapped into the settlement asset.",
  },
  /**
   * The counter-account to `PAYER_ASSET_HELD`.
   *
   * The asset is held but not owned: it is committed to converting into a
   * specific payment's settlement. Crediting a liability rather than revenue
   * says exactly that, and keeps the receipt from touching the settlement
   * asset at all — which is the point, since none has been acquired yet.
   */
  PAYER_ASSET_OBLIGATION: {
    type: "LIABILITY",
    name: "Payer asset obligation",
    description: "Payer assets held against an unconverted payment obligation.",
  },
  /**
   * The difference between the price locked and the swap actually achieved.
   *
   * `REVENUE`, so a credit balance is a gain. A loss is a debit, leaving the
   * account with a negative balance — which is the honest presentation: it is
   * one account whose sign says which way the exposure went, not two accounts
   * that must be netted to find out. This is the exposure `docs/threat-model.md`
   * depends on being visible; absorbing it into treasury is what made it
   * invisible.
   */
  FX_RESULT: {
    type: "REVENUE",
    name: "FX result",
    description:
      "Gain or loss between the locked price and the swap actually achieved. Debit balance is a loss.",
  },
  /**
   * The payer's own change, on a cross-asset x402 payment (#211).
   *
   * The `exact` scheme takes a fixed authorization and nothing may top it up,
   * so the amount the agent signs for is the exact-output quote grossed up by
   * slippage — deliberately more than the swap is expected to consume. The
   * difference is the payer's, not a gain: `FX_RESULT` would call it Mayarin's
   * exposure between the lock and the fill, and it is neither.
   *
   * `LIABILITY`, because we are holding somebody else's money. A credit balance
   * here is change owed back, and it stays owed until it is returned. Change
   * too small to be worth a transaction never reaches this account at all: it
   * is taken as `FEE_REVENUE`, stated in the receipt event, and the line is
   * `dustThreshold` in the asset registry. On the contract path the
   * same money never reaches this account: `PaymentRouter._returnResidue` hands
   * it back inside the same transaction, which x402 cannot do because the payer
   * is not the sender.
   */
  PAYER_SURPLUS: {
    type: "LIABILITY",
    name: "Payer surplus",
    description:
      "Payer asset authorised but not consumed by a cross-asset swap, held against a return to the payer.",
  },
  /** Gas Mayarin pays on a payer's behalf. */
  GAS_EXPENSE: {
    type: "EXPENSE",
    name: "Gas expense",
    description: "Network fees Mayarin pays to execute a payment it did not charge the payer for.",
  },
  /** The operator key's native balance, which gas is drawn from. */
  OPERATOR_GAS: {
    type: "ASSET",
    name: "Operator gas balance",
    description: "Native asset held by the executor operator key and spent on gas.",
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
