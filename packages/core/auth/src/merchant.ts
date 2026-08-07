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

import type { AssetCode } from "@mayarin/shared";

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
}
