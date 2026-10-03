/** Notifications client — the bell over `/notifications`. */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import { listPath } from "@/lib/api/list-path";
import type { NotificationFeedFilter, NotificationFeedResponse } from "@/types/notifications";

export const notificationsApi = {
  /** GET `/notifications` — one page, newest first, each marked unread or not. */
  feed: (
    filter: NotificationFeedFilter = {},
    cursor?: string,
  ): Effect.Effect<NotificationFeedResponse, ApiError> =>
    request<NotificationFeedResponse>(listPath("/notifications", filter, cursor)),

  /** POST `/notifications/read` — everything in the feed is now seen by this account. */
  markAllRead: (): Effect.Effect<void, ApiError> =>
    request<void>("/notifications/read", { method: "POST" }),
};
