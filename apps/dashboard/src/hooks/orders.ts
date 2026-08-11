/**
 * Order hooks — the commerce view of `/payments`. Mirrors `lib/api/orders`
 * one-to-one.
 *
 * Polls while any order is still in flight, and stops once nothing can move —
 * the same rule as settlements, so one abandoned cart does not keep a
 * five-second poll running for as long as the tab is open.
 */

import type { ApiError } from "@/lib/api/client";
import { ordersApi } from "@/lib/api/orders";
import { useEffectQuery } from "@/lib/query";
import type { OrderListFilter, OrderListResponse } from "@/types/orders";

/** Terminal intent states — nothing about these rows will change again. */
const TERMINAL_STATES: readonly string[] = ["COMPLETED", "FAILED", "EXPIRED"];

export function useOrders(limit?: number, customerId?: string) {
  return useOrderPage({
    ...(limit === undefined ? {} : { limit }),
    ...(customerId === undefined ? {} : { customerId }),
  });
}

export function useOrderPage(filter: OrderListFilter, cursor?: string) {
  return useEffectQuery<OrderListResponse, ApiError>({
    queryKey: ["orders", "list", filter, cursor ?? null],
    query: () => ordersApi.list(filter, cursor),
    refetchInterval: (data) => {
      const live = (data?.orders ?? []).some((order) => !TERMINAL_STATES.includes(order.status));
      return live ? 5_000 : false;
    },
  });
}
