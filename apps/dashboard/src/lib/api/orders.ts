/**
 * Orders API — read-only commerce view over `/orders`. Mirrors the dashboard
 * API route. Merchant-scoped server-side, like every other read here.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type { OrderListResponse } from "@/types/orders";

/** Builds the query string for optional list parameters. */
function query(limit?: number, customerId?: string): string {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (customerId !== undefined) params.set("customerId", customerId);
  const qs = params.toString();
  return qs === "" ? "" : `?${qs}`;
}

export const ordersApi = {
  list: (limit?: number, customerId?: string): Effect.Effect<OrderListResponse, ApiError> =>
    request<OrderListResponse>(`/orders${query(limit, customerId)}`),
};
