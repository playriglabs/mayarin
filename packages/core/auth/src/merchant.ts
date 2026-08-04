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

export interface Merchant {
  readonly id: string;
  readonly name: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MerchantRepository {
  insert(merchant: Merchant): Promise<Merchant>;
  findById(id: string): Promise<Merchant | null>;
  list(): Promise<readonly Merchant[]>;
}
