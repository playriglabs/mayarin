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

import type { ChainId } from "@mayarin/chain";
import { type AssetCode, getAsset, ValidationError } from "@mayarin/shared";
import type { User } from "./types.ts";

/** Accepted payer assets narrowed to one chain. A chain absent inherits the merchant-wide set. */
export type AcceptedAssetsByChain = Readonly<Partial<Record<ChainId, readonly AssetCode[]>>>;

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
   * The same choice, narrowed per chain (#244).
   *
   * `acceptedAssets` is one list for a merchant who is paid on one chain. With
   * two, the list stops describing either: Base can take ETH and Arc cannot, so
   * a merchant who accepts ETH is not saying they accept it everywhere.
   *
   * A chain **absent** here inherits `acceptedAssets`, which is the state every
   * existing merchant is in and the state a merchant who never opens the matrix
   * stays in. A chain **present** carries its own non-empty list, and an empty
   * list is never stored — clearing a chain's row removes it, which restores
   * the inherited set rather than accepting nothing.
   *
   * Optional, and absent is the same answer as empty: every chain inherits.
   * Read it through `acceptedAssetsOn` rather than indexing it.
   */
  readonly acceptedAssetsByChain?: AcceptedAssetsByChain;
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
  /**
   * Where the merchant trades, as a buyer is shown it.
   *
   * Part of the merchant snapshot every Payment Intent freezes, and an EMVCo
   * QR carries both fields by construction. Optional because a merchant exists
   * before anyone has filled in their profile — but a payment link cannot be
   * minted without them, so the surface that mints links asks for them.
   */
  readonly city?: string;
  /** ISO 3166-1 alpha-2, uppercase. */
  readonly countryCode?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /**
   * Incremented on every edit; the optimistic-locking token the repository
   * takes.
   *
   * `settlement_address` decides where this merchant's money is paid, so two
   * people editing it at once must not silently resolve to whichever write
   * landed second. The audit trail records both attempts either way — this is
   * what stops the losing one from taking effect.
   */
  readonly version: number;
}

export interface MerchantRepository {
  insert(merchant: Merchant): Promise<Merchant>;
  findById(id: string): Promise<Merchant | null>;
  list(): Promise<readonly Merchant[]>;
  /**
   * Persists an edited merchant.
   *
   * Takes the version the caller read, so a concurrent edit raises
   * `ConcurrencyError` rather than overwriting the other writer's change. Rare
   * as that is inside one tenant, the field being written decides where the
   * merchant's money goes — which is not a field to be relaxed about.
   */
  update(merchant: Merchant, expectedVersion: number): Promise<void>;
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
  "acceptedAssetsByChain",
  "settlementAddress",
  "city",
  "countryCode",
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
   * Per-chain overrides, replacing the whole map when present.
   *
   * A whole-map replace rather than a per-chain merge: the settings screen
   * edits the matrix as one thing, and a merge gives a merchant no way to
   * remove a chain's override at all.
   */
  readonly acceptedAssetsByChain?: AcceptedAssetsByChain;
  /**
   * `null` clears the address; absent leaves it alone. The two are different
   * requests and a merchant making the first should not be told they made the
   * second.
   */
  readonly settlementAddress?: string | null;
  /** Same `null`-clears-it rule as the address. */
  readonly city?: string | null;
  readonly countryCode?: string | null;
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

  const acceptedAssetsByChain =
    patch.acceptedAssetsByChain === undefined
      ? (merchant.acceptedAssetsByChain ?? {})
      : narrowPerChain(patch.acceptedAssetsByChain, settlementAsset);

  const settlementAddress =
    patch.settlementAddress === undefined
      ? merchant.settlementAddress
      : patch.settlementAddress === null
        ? undefined
        : normaliseAddress(patch.settlementAddress);

  const city = patchOptional(patch.city, merchant.city, normaliseCity);
  const countryCode = patchOptional(patch.countryCode, merchant.countryCode, normaliseCountryCode);

  // Destructured away rather than spread over: `...merchant` would carry the
  // existing values through, so clearing one would silently leave it in place.
  const { settlementAddress: _address, city: _city, countryCode: _country, ...rest } = merchant;

  return {
    ...rest,
    settlementAsset,
    acceptedAssets,
    acceptedAssetsByChain,
    ...(settlementAddress === undefined ? {} : { settlementAddress }),
    ...(city === undefined ? {} : { city }),
    ...(countryCode === undefined ? {} : { countryCode }),
    updatedAt: new Date(now),
    version: merchant.version + 1,
  };
}

/** Absent leaves the current value, `null` clears it, a value is normalised. */
function patchOptional(
  patched: string | null | undefined,
  current: string | undefined,
  normalise: (value: string) => string,
): string | undefined {
  if (patched === undefined) return current;
  if (patched === null) return undefined;
  return normalise(patched);
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

  const beforeByChain = renderPerChain(before.acceptedAssetsByChain ?? {});
  const afterByChain = renderPerChain(after.acceptedAssetsByChain ?? {});
  if (beforeByChain !== afterByChain) {
    changes.push({
      field: "acceptedAssetsByChain",
      previous: beforeByChain,
      next: afterByChain,
    });
  }

  for (const field of ["settlementAddress", "city", "countryCode"] as const) {
    if (before[field] === after[field]) continue;
    changes.push({
      field,
      ...(before[field] === undefined ? {} : { previous: before[field] }),
      ...(after[field] === undefined ? {} : { next: after[field] }),
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

function normaliseCity(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 64) {
    throw new ValidationError("A city must be between 1 and 64 characters", { city: trimmed });
  }
  return trimmed;
}

/**
 * ISO 3166-1 alpha-2, uppercased.
 *
 * Two letters and nothing else: the EMVCo tag it ends up in is fixed-width, so
 * a three-letter code accepted here is a QR that fails to parse at a terminal.
 */
function normaliseCountryCode(value: string): string {
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(trimmed)) {
    throw new ValidationError("A country code is two letters, e.g. ID", { countryCode: trimmed });
  }
  return trimmed;
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
 * Normalises the per-chain matrix: same dedupe rule, and no empty rows.
 *
 * An empty row is dropped rather than stored, because "accept nothing on this
 * chain" and "inherit the merchant-wide set" would otherwise be the same value
 * with two meanings. A merchant who wants a chain off turns the chain off —
 * that is the settlement destination, not this list.
 */
function narrowPerChain(
  byChain: AcceptedAssetsByChain,
  settlementAsset: AssetCode,
): AcceptedAssetsByChain {
  const narrowed: Partial<Record<ChainId, readonly AssetCode[]>> = {};
  for (const [chain, assets] of Object.entries(byChain) as [ChainId, readonly AssetCode[]][]) {
    if (assets === undefined || assets.length === 0) continue;
    narrowed[chain] = dedupe(assets, settlementAsset);
  }
  return narrowed;
}

/** One stable line per matrix, so the audit record compares like with like. */
function renderPerChain(byChain: AcceptedAssetsByChain): string {
  return (Object.entries(byChain) as [ChainId, readonly AssetCode[]][])
    .filter(([, assets]) => assets !== undefined && assets.length > 0)
    .map(([chain, assets]) => `${chain}=${[...assets].join("+")}`)
    .sort()
    .join(",");
}

/**
 * The assets a payer may send this merchant on one chain (#244).
 *
 * The per-chain row when there is one, the merchant-wide list otherwise, and
 * empty when the merchant has expressed no preference at all — which the
 * caller reads as "whatever this chain can receive", never as "nothing".
 */
export function acceptedAssetsOn(merchant: Merchant, chain: ChainId): readonly AssetCode[] {
  const perChain = merchant.acceptedAssetsByChain?.[chain];
  return perChain !== undefined && perChain.length > 0 ? perChain : merchant.acceptedAssets;
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
