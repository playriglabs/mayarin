/**
 * Event logs client — the merchant timeline over `/event-logs`. Mirrors the
 * dashboard API route. Read-only, so the central client attaches no CSRF token.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import { listPath } from "@/lib/api/list-path";
import type { EventLogListFilter, EventLogListResponse } from "@/types/event-logs";

export const eventLogsApi = {
  list: (
    filter: EventLogListFilter = {},
    cursor?: string,
  ): Effect.Effect<EventLogListResponse, ApiError> =>
    request<EventLogListResponse>(listPath("/event-logs", filter, cursor)),
};
