/**
 * Postgres adapter for `SubscriptionRepository` (#296).
 */

import { ConcurrencyError } from "@mayarin/shared";
import type {
  Subscription,
  SubscriptionInterval,
  SubscriptionRepository,
  SubscriptionState,
} from "@mayarin/subscriptions";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, toMoney } from "../mapping.ts";
import { subscriptions } from "../schema.ts";

export class DrizzleSubscriptionRepository implements SubscriptionRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(subscription: Subscription): Promise<void> {
    await this.#db.insert(subscriptions).values(toRow(subscription));
  }

  async update(subscription: Subscription, expectedVersion: number): Promise<void> {
    const updated = await this.#db
      .update(subscriptions)
      .set(toRow(subscription))
      .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.version, expectedVersion)))
      .returning({ id: subscriptions.id });
    if (updated.length === 0) {
      throw new ConcurrencyError(`Subscription ${subscription.id} was modified concurrently`, {
        id: subscription.id,
        expectedVersion,
      });
    }
  }

  async findById(id: string): Promise<Subscription | null> {
    const [row] = await this.#db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, id))
      .limit(1);
    return row === undefined ? null : toSubscription(row);
  }

  async listByMerchant(merchantId: string): Promise<readonly Subscription[]> {
    const rows = await this.#db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.merchantId, merchantId))
      .orderBy(desc(subscriptions.createdAt), desc(subscriptions.id));
    return rows.map(toSubscription);
  }

  async listActive(limit: number): Promise<readonly Subscription[]> {
    const rows = await this.#db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.state, "active"))
      .orderBy(asc(subscriptions.createdAt))
      .limit(limit);
    return rows.map(toSubscription);
  }
}

function toRow(subscription: Subscription): typeof subscriptions.$inferInsert {
  return {
    id: subscription.id,
    merchantId: subscription.merchantId,
    customerId: subscription.subscriber.customerId,
    subscriberName: subscription.subscriber.name,
    subscriberEmail: subscription.subscriber.email ?? null,
    description: subscription.description,
    amount: subscription.amount.amount.toString(),
    asset: subscription.amount.asset,
    interval: subscription.interval,
    anchorAt: subscription.anchorAt,
    billedCycles: subscription.billedCycles,
    daysUntilDue: subscription.daysUntilDue,
    state: subscription.state,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
    cancelledAt: subscription.cancelledAt ?? null,
    version: subscription.version,
  };
}

function toSubscription(row: typeof subscriptions.$inferSelect): Subscription {
  return {
    id: row.id,
    merchantId: row.merchantId,
    subscriber: {
      customerId: row.customerId,
      name: row.subscriberName,
      ...present("email", row.subscriberEmail),
    },
    description: row.description,
    amount: toMoney(row.amount, row.asset),
    interval: row.interval as SubscriptionInterval,
    anchorAt: row.anchorAt,
    billedCycles: row.billedCycles,
    daysUntilDue: row.daysUntilDue,
    state: row.state as SubscriptionState,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...present("cancelledAt", row.cancelledAt),
    version: row.version,
  };
}
