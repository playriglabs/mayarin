/**
 * Settlement API — read-only surface over `/settlements`. Merchant-scoped
 * server-side, like every other read here.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import { listPath } from "@/lib/api/list-path";
import type { SettlementListResponse } from "@/types/settlement";

export const settlementsApi = {
  list: (limit?: number, cursor?: string): Effect.Effect<SettlementListResponse, ApiError> =>
    request<SettlementListResponse>(
      listPath("/settlements", limit === undefined ? {} : { limit }, cursor),
    ),
};
