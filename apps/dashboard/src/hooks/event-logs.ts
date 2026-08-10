/**
 * Event log hooks — one React Query hook over `/event-logs`. Mirrors
 * `lib/api/event-logs` one-to-one.
 *
 * Polls while the newest event is under a minute old, then stops — a timeline
 * of historical events is static, and a live one goes quiet fast. Same shape as
 * the settlements poll, tuned to a timeline rather than a state machine.
 */

import type { ApiError } from "@/lib/api/client";
import { eventLogsApi } from "@/lib/api/event-logs";
import { useLiveChannel } from "@/lib/live-updates";
import { useEffectQuery } from "@/lib/query";
import type { EventLogListFilter, EventLogListResponse } from "@/types/event-logs";

const RECENT_WINDOW_MS = 60_000;

export function useEventLogs(filter: EventLogListFilter = {}, cursor?: string) {
  const isStreamConnected = useLiveChannel("event-logs");
  return useEffectQuery<EventLogListResponse, ApiError>({
    queryKey: ["event-logs", "list", filter, cursor ?? null],
    query: () => eventLogsApi.list(filter, cursor),
    refetchInterval: (data) => {
      if (isStreamConnected) return false;
      const newest = data?.events[0];
      if (newest === undefined) return false;
      const age = Date.now() - Date.parse(newest.occurredAt);
      return age < RECENT_WINDOW_MS ? 5_000 : false;
    },
  });
}
