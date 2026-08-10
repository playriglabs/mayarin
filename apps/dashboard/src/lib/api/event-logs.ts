/**
 * Event logs client — the merchant timeline over `/event-logs`. Mirrors the
 * dashboard API route. Read-only, so the central client attaches no CSRF token.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type { EventLogListResponse } from "@/types/event-logs";

function query(limit?: number): string {
  if (limit === undefined) return "";
  return `?limit=${String(limit)}`;
}

export const eventLogsApi = {
  list: (limit?: number): Effect.Effect<EventLogListResponse, ApiError> =>
    request<EventLogListResponse>(`/event-logs${query(limit)}`),
};
