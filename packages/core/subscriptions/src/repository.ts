import type { Subscription } from "./types.ts";

export interface SubscriptionRepository {
  insert(subscription: Subscription): Promise<void>;
  /** Refuses with `ConcurrencyError` when the stored version is not `expectedVersion`. */
  update(subscription: Subscription, expectedVersion: number): Promise<void>;
  findById(id: string): Promise<Subscription | null>;
  /** Newest first. */
  listByMerchant(merchantId: string): Promise<readonly Subscription[]>;
  /**
   * Active subscriptions, oldest first, for the billing tick to check. Whether
   * each is actually due is decided by `isDue`, not by the query — the next
   * date is derived, not stored.
   */
  listActive(limit: number): Promise<readonly Subscription[]>;
}
