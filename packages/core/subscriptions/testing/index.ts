/** The reference in-memory `SubscriptionRepository`, for tests. */

import { ConcurrencyError } from "@mayarin/shared";
import type { SubscriptionRepository } from "../src/repository.ts";
import type { Subscription } from "../src/types.ts";

export class InMemorySubscriptionRepository implements SubscriptionRepository {
  readonly #rows = new Map<string, Subscription>();

  async insert(subscription: Subscription): Promise<void> {
    this.#rows.set(subscription.id, subscription);
  }

  async update(subscription: Subscription, expectedVersion: number): Promise<void> {
    const held = this.#rows.get(subscription.id);
    if (held === undefined || held.version !== expectedVersion) {
      throw new ConcurrencyError("Subscription changed underneath this update", {
        id: subscription.id,
        expectedVersion,
      });
    }
    this.#rows.set(subscription.id, subscription);
  }

  async findById(id: string): Promise<Subscription | null> {
    return this.#rows.get(id) ?? null;
  }

  async listByMerchant(merchantId: string): Promise<readonly Subscription[]> {
    return [...this.#rows.values()]
      .filter((row) => row.merchantId === merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  }

  async listActive(limit: number): Promise<readonly Subscription[]> {
    return [...this.#rows.values()]
      .filter((row) => row.state === "active")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);
  }
}
