/**
 * Merchant account tenant.
 *
 * A merchant is the account tenant: every `User` belongs to exactly one
 * merchant (`user.merchantId`). The merchant id also keys the payments a user
 * can see — `paymentIntents.merchantId` must equal it for the scope filter to
 * match. New merchants get an `mrc_<ulid>` id (see `@mayarin/shared` ids);
 * historically-denormalised payment merchant ids are preserved as-is.
 *
 * Pure data only — no I/O, no clock. The repository port is implemented outside
 * core (`packages/db`).
 */

import { type AssetCode, getAsset, ValidationError } from "@mayarin/shared";
import type { User } from "./types.ts";

export interface Merchant {
  readonly id: string;
  readonly name: string;
  /**
   * The single asset this merchant is paid in. A merchant prices in their local
   * currency and never handles anything else — whatever the payer sends is
   * converted to this before it reaches them.
   */
  readonly settlementAsset: AssetCode;
  /**
   * Assets this merchant lets a payer pay with. An entry equal to
   * `settlementAsset` settles with no swap at all; anything else is swapped on
   * the way in. Empty means the deployment default applies.
   */
  readonly acceptedAssets: readonly AssetCode[];
  /**
   * Where this merchant is paid on-chain — the signed order's `merchantSafe`.
   *
   * Optional because a merchant who only settles off-chain never needs one, but
   * the on-chain-contract path refuses to lock without it. There is deliberately
   * no deployment-wide fallback: a single configured address would pay every
   * merchant on the deployment into the same wallet.
   *
   * Not required to be a Safe. The contract treats the field as opaque, and #11
   * is what makes it a managed smart account.
   */
  readonly settlementAddress?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MerchantRepository {
  insert(merchant: Merchant): Promise<Merchant>;
  findById(id: string): Promise<Merchant | null>;
  list(): Promise<readonly Merchant[]>;
  /**
   * Persists an edited merchant.
   *
   * No expected-version argument, and no `version` column behind it: merchant
   * settings are edited rarely and by a handful of people inside one tenant, so
   * last-writer-wins is the honest trade. What makes that acceptable is the
   * audit trail — a lost update is still visible as two recorded changes, which
   * is the property that actually matters for a field that redirects money.
   */
  update(merchant: Merchant): Promise<void>;
}

/**
 * A field of a merchant's settings that changed, and what it changed from.
 *
 * Append-only. `settlementAddress` is a redirect of that merchant's money, so
 * "who changed it and when" has to survive the change itself; recording the
 * other two costs nothing and keeps one shape for all of them.
 */
export interface MerchantSettingChange {
  readonly id: string;
  readonly merchantId: string;
  /** The account that made the change. */
  readonly userId: string;
  readonly field: MerchantSettingField;
  /** Rendered values, not typed ones — this is a record to read, not to replay. */
  readonly previousValue?: string;
  readonly nextValue?: string;
  readonly changedAt: Date;
}

export const MERCHANT_SETTING_FIELDS = [
  "settlementAsset",
  "acceptedAssets",
  "settlementAddress",
] as const;

export type MerchantSettingField = (typeof MERCHANT_SETTING_FIELDS)[number];

export interface MerchantSettingChangeRepository {
  /** Writes the changes for one edit. Never updates or deletes. */
  append(changes: readonly MerchantSettingChange[]): Promise<void>;
  list(merchantId: string, limit?: number): Promise<readonly MerchantSettingChange[]>;
}

/** The subset of a merchant a merchant may edit about themselves. */
export interface MerchantSettingsPatch {
  readonly settlementAsset?: AssetCode;
  readonly acceptedAssets?: readonly AssetCode[];
  /**
   * `null` clears the address; absent leaves it alone. The two are different
   * requests and a merchant making the first should not be told they made the
   * second.
   */
  readonly settlementAddress?: string | null;
}

/**
 * Applies a settings patch, validating before anything is stored.
 *
 * Validation happens here rather than at `PRICE_LOCKED` because a malformed
 * payout address discovered at lock time is a payment that fails months after
 * the mistake was made, with nothing left to point at the person who made it.
 */
export function updateMerchantSettings(
  merchant: Merchant,
  patch: MerchantSettingsPatch,
  now: Date,
): Merchant {
  const settlementAsset = patch.settlementAsset ?? merchant.settlementAsset;
  if (getAsset(settlementAsset).kind !== "stablecoin") {
    throw new ValidationError(
      `A merchant settles in a stablecoin; ${settlementAsset} is ${getAsset(settlementAsset).kind}`,
      { settlementAsset },
    );
  }

  const acceptedAssets =
    patch.acceptedAssets === undefined
      ? merchant.acceptedAssets
      : dedupe(patch.acceptedAssets, settlementAsset);

  const settlementAddress =
    patch.settlementAddress === undefined
      ? merchant.settlementAddress
      : patch.settlementAddress === null
        ? undefined
        : normaliseAddress(patch.settlementAddress);

  // Destructured away rather than spread over: `...merchant` would carry the
  // existing address through, so clearing one would silently leave it in place.
  const { settlementAddress: _previous, ...rest } = merchant;

  return {
    ...rest,
    settlementAsset,
    acceptedAssets,
    ...(settlementAddress === undefined ? {} : { settlementAddress }),
    updatedAt: new Date(now),
  };
}

/** The fields that actually differ between two versions of a merchant. */
export function diffMerchantSettings(
  before: Merchant,
  after: Merchant,
): readonly { field: MerchantSettingField; previous?: string; next?: string }[] {
  const changes: { field: MerchantSettingField; previous?: string; next?: string }[] = [];

  if (before.settlementAsset !== after.settlementAsset) {
    changes.push({
      field: "settlementAsset",
      previous: before.settlementAsset,
      next: after.settlementAsset,
    });
  }

  const beforeAccepted = before.acceptedAssets.join(",");
  const afterAccepted = after.acceptedAssets.join(",");
  if (beforeAccepted !== afterAccepted) {
    changes.push({ field: "acceptedAssets", previous: beforeAccepted, next: afterAccepted });
  }

  if (before.settlementAddress !== after.settlementAddress) {
    changes.push({
      field: "settlementAddress",
      ...(before.settlementAddress === undefined ? {} : { previous: before.settlementAddress }),
      ...(after.settlementAddress === undefined ? {} : { next: after.settlementAddress }),
    });
  }

  return changes;
}

/**
 * A 20-byte hex address, lowercased.
 *
 * Not checksum-validated: EIP-55 mixed case is a hint, and rejecting an
 * all-lowercase address a merchant copied from a block explorer would refuse a
 * correct address. What is refused is a wrong shape and the zero address, which
 * is a burn destination rather than a payout one.
 */
function normaliseAddress(value: string): string {
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new ValidationError(
      "A settlement address must be a 20-byte hex address, e.g. 0x1234…abcd",
      { settlementAddress: trimmed },
    );
  }
  const lowered = trimmed.toLowerCase();
  if (lowered === `0x${"0".repeat(40)}`) {
    throw new ValidationError("The zero address cannot receive settlement", {});
  }
  return lowered;
}

/**
 * Deduplicates the accepted set and keeps the settlement asset in it.
 *
 * A merchant who accepts nothing they settle in has configured a merchant that
 * must swap on every single payment, which is almost never what they meant and
 * is expensive when it is.
 */
function dedupe(assets: readonly AssetCode[], settlementAsset: AssetCode): readonly AssetCode[] {
  if (assets.length === 0) return [];
  return [...new Set([settlementAsset, ...assets])];
}

/**
 * Creating a merchant and its first account as one unit (issue #100).
 *
 * A merchant with no user is unreachable: nothing can sign in to it, and no
 * code path deletes it. Writing the two rows through separate repositories
 * leaves exactly that behind whenever the second write fails — a duplicate
 * email being the common way, since the operator sees an error, assumes nothing
 * happened, and tries again under a different name.
 *
 * Kept as its own port rather than a method on `MerchantRepository` because the
 * unit spans two aggregates and belongs to neither. The atomicity lives in the
 * implementation, as it does for `ClearingTransactionRepository.insert`, so no
 * service has to know that a transaction exists.
 */
export interface MerchantAccountRepository {
  /** Writes both rows or neither. */
  insertWithFirstUser(merchant: Merchant, user: User): Promise<void>;
}
