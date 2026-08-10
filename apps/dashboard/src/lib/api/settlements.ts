/**
 * Settlement API — read-only surface over `/settlements`. Merchant-scoped
 * server-side, like every other read here.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type { SettlementListResponse } from "@/types/settlement";

export const settlementsApi = {
  list: (limit?: number): Effect.Effect<SettlementListResponse, ApiError> =>
    request<SettlementListResponse>(
      limit === undefined ? "/settlements" : `/settlements?limit=${limit}`,
    ),
};
