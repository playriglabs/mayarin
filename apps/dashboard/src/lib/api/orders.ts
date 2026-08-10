/**
 * Orders API — read-only commerce view over `/orders`. Mirrors the dashboard
 * API route. Merchant-scoped server-side, like every other read here.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import { listPath } from "@/lib/api/list-path";
import type { OrderListFilter, OrderListResponse } from "@/types/orders";

export const ordersApi = {
  list: (
    filter: OrderListFilter = {},
    cursor?: string,
  ): Effect.Effect<OrderListResponse, ApiError> =>
    request<OrderListResponse>(listPath("/orders", filter, cursor)),
};
