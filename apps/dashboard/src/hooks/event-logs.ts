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
import { useEffectQuery } from "@/lib/query";
import type { EventLogListResponse } from "@/types/event-logs";

const RECENT_WINDOW_MS = 60_000;

export function useEventLogs(limit?: number) {
  return useEffectQuery<EventLogListResponse, ApiError>({
    queryKey: ["event-logs", "list", limit ?? null],
    query: () => eventLogsApi.list(limit),
    refetchInterval: (data) => {
      const newest = data?.events[0];
      if (newest === undefined) return false;
      const age = Date.now() - Date.parse(newest.occurredAt);
      return age < RECENT_WINDOW_MS ? 5_000 : false;
    },
  });
}
