/**
 * Notification hooks. The bell and the page share the `["notifications"]` key.
 *
 * Polled once a minute rather than tied to the live stream: the stream ticks
 * every few seconds, and the feed reads more sources than a payment list.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ApiError } from "@/lib/api/client";
import { notificationsApi } from "@/lib/api/notifications";
import { useEffectQuery } from "@/lib/query";
import { runEffect } from "@/lib/run";
import type { NotificationFeedFilter, NotificationFeedResponse } from "@/types/notifications";

const POLL_MS = 60_000;
/** How long a row stays marked new after it has been seen. */
const DOT_LINGER_MS = 2_000;

export function useNotifications(filter: NotificationFeedFilter = {}, cursor?: string) {
  return useEffectQuery<NotificationFeedResponse, ApiError>({
    queryKey: ["notifications", filter, cursor ?? null],
    query: () => notificationsApi.feed(filter, cursor),
    refetchInterval: POLL_MS,
  });
}

/**
 * Marks everything seen once the reader is looking at it (`active`) and there
 * is something unread.
 *
 * The badge clears at once; the rows keep their unread dot for a moment
 * longer, so the reader can still tell which ones were new, then lose it.
 * Both are cache edits, not a refetch: the server already agrees.
 */
export function useMarkSeen(active: boolean, unread: number) {
  const client = useQueryClient();
  const { mutate, isPending } = useMutation({
    mutationFn: () => runEffect(notificationsApi.markAllRead()),
    onSuccess: () => {
      client.setQueriesData<NotificationFeedResponse>({ queryKey: ["notifications"] }, (data) =>
        data === undefined ? data : { ...data, unread: 0 },
      );
      setTimeout(() => {
        client.setQueriesData<NotificationFeedResponse>({ queryKey: ["notifications"] }, (data) =>
          data === undefined
            ? data
            : {
                ...data,
                notifications: data.notifications.map((n) => ({ ...n, unread: false })),
              },
        );
      }, DOT_LINGER_MS);
    },
  });
  useEffect(() => {
    if (active && unread > 0 && !isPending) mutate();
  }, [active, unread, isPending, mutate]);
}
