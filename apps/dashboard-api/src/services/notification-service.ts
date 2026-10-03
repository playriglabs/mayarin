/**
 * The merchant's notifications — the bell in the dashboard header.
 *
 * A read over records the system already keeps (see
 * `DrizzleMerchantNotificationRepository`); the only thing written here is the
 * reader's "seen up to" mark. Unread is "occurred after that mark", so marking
 * everything read is one update, and a notification cannot be unread for one
 * reason and read for another.
 *
 * Configuration notices — sign-ins, API keys, settings, webhooks — are shown
 * only to accounts that manage settings. Reading payments is no reason to see
 * who signed in, and those accounts cannot act on any of them.
 */

import type { MerchantNotification, MerchantNotificationQuery } from "@mayarin/db";
import type { Clock } from "@mayarin/shared";
import { can, type Scope } from "../dto/auth.ts";
import { NOTIFICATION_CATEGORY, type NotificationCategory } from "../dto/notifications.ts";

/**
 * How far back the feed reaches. Every page reads this many and slices, so a
 * category filter and the unread count see the same set the pages do — the
 * cost is a bounded read per source, not a cursor per source.
 */
const FEED_DEPTH = 200;

/** The slice of the notification repository this service reads and writes through. */
export interface NotificationStore {
  list(
    merchantId: string,
    query: MerchantNotificationQuery,
  ): Promise<readonly MerchantNotification[]>;
  readAt(userId: string): Promise<Date | undefined>;
  markRead(userId: string, at: Date): Promise<void>;
}

export interface NotificationFeed {
  readonly notifications: readonly (MerchantNotification & { readonly unread: boolean })[];
  /** Across the whole feed, not this page — it is the bell's badge. */
  readonly unread: number;
  /** The offset of the next page, or null on the last one. */
  readonly nextCursor: string | null;
}

export interface NotificationPage {
  readonly limit: number;
  readonly cursor?: string;
  readonly category?: NotificationCategory;
}

/** Who is reading: the session's account and session, absent for an API key. */
export interface NotificationReader {
  readonly userId: string;
  readonly sessionId: string;
}

export class NotificationService {
  readonly #store: NotificationStore;
  readonly #clock: Clock;

  constructor(options: { readonly store: NotificationStore; readonly clock: Clock }) {
    this.#store = options.store;
    this.#clock = options.clock;
  }

  async feed(
    scope: Scope,
    reader: NotificationReader | undefined,
    page: NotificationPage,
  ): Promise<NotificationFeed> {
    const [all, readAt] = await Promise.all([
      this.#store.list(scope.merchantId, {
        now: this.#clock.now(),
        limit: FEED_DEPTH,
        ...(reader === undefined ? {} : { excludeSessionId: reader.sessionId }),
      }),
      reader === undefined ? undefined : this.#store.readAt(reader.userId),
    ]);
    const visible = all
      .filter((notification) => can(scope, "settings:manage") || !isConfiguration(notification))
      .map((notification) => ({
        ...notification,
        unread: readAt === undefined || notification.occurredAt.getTime() > readAt.getTime(),
      }));
    const filtered = visible.filter(
      (notification) =>
        page.category === undefined || NOTIFICATION_CATEGORY[notification.type] === page.category,
    );
    const offset = offsetOf(page.cursor);
    const end = offset + page.limit;
    return {
      notifications: filtered.slice(offset, end),
      unread: visible.filter((notification) => notification.unread).length,
      nextCursor: filtered.length > end ? String(end) : null,
    };
  }

  async markAllRead(reader: NotificationReader): Promise<void> {
    await this.#store.markRead(reader.userId, this.#clock.now());
  }
}

/** A cursor is the offset into the feed; anything unreadable starts at the top. */
function offsetOf(cursor: string | undefined): number {
  const offset = Number(cursor);
  return Number.isSafeInteger(offset) && offset > 0 ? offset : 0;
}

function isConfiguration(notification: MerchantNotification): boolean {
  return (
    notification.type.startsWith("security.") ||
    notification.type === "settings.changed" ||
    notification.type === "webhook.failed"
  );
}
