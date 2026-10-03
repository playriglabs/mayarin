import type { MerchantNotification, MerchantNotificationQuery } from "@mayarin/db";
import type { NotificationStore } from "../../src/services/notification-service.ts";

/** The feed as a test seeds it, plus each account's seen mark. */
export class InMemoryNotificationStore implements NotificationStore {
  readonly #rows: { merchantId: string; notification: MerchantNotification }[] = [];
  readonly #readAt = new Map<string, Date>();

  seed(merchantId: string, notification: MerchantNotification): void {
    this.#rows.push({ merchantId, notification });
  }

  async list(
    merchantId: string,
    query: MerchantNotificationQuery,
  ): Promise<readonly MerchantNotification[]> {
    return this.#rows
      .filter((row) => row.merchantId === merchantId)
      .map((row) => row.notification)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, query.limit);
  }

  async readAt(userId: string): Promise<Date | undefined> {
    return this.#readAt.get(userId);
  }

  async markRead(userId: string, at: Date): Promise<void> {
    this.#readAt.set(userId, at);
  }
}
