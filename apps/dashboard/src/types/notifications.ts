/**
 * Notification wire types, mirrored from the dashboard API DTOs.
 *
 * The API words each line; the dashboard shows `title` and `body` as they are,
 * picks an icon by `category` and a colour by `tone`, and links to `href`.
 */

import type { MoneyDto } from "@/types/payment";

export type NotificationCategory = "payment" | "dispute" | "security" | "operations";

export type NotificationTone = "info" | "success" | "warning" | "error";

export interface NotificationDto {
  readonly id: string;
  readonly type: string;
  readonly category: NotificationCategory;
  readonly tone: NotificationTone;
  readonly title: string;
  readonly body: string | null;
  readonly href: string | null;
  readonly amount: MoneyDto | null;
  readonly occurredAt: string;
  readonly unread: boolean;
}

export interface NotificationFeedResponse {
  readonly notifications: readonly NotificationDto[];
  /** Across the whole feed, not this page. */
  readonly unread: number;
  readonly nextCursor: string | null;
}

export interface NotificationFeedFilter {
  readonly limit?: number;
  readonly category?: NotificationCategory;
}
