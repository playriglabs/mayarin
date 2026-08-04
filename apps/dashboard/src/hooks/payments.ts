/**
 * Payment hooks — one React Query hook per `/payments` route. Components
 * consume `const payments = usePayments()` and read `payments.data`; they never
 * touch `useEffectQuery` or `paymentsApi` directly. Mirrors `lib/api/payments`
 * one-to-one.
 */

import type { ApiError } from "@/lib/api/client";
import { paymentsApi } from "@/lib/api/payments";
import { useEffectQuery } from "@/lib/query";
import type { PaymentDetailResponse, PaymentListResponse } from "@/types/payment";

/** GET `/payments` — the caller's own merchant only. */
export function usePayments(limit?: number) {
  return useEffectQuery<PaymentListResponse, ApiError>({
    queryKey: ["payments", "list", limit ?? null],
    query: () => paymentsApi.list(limit),
  });
}

/**
 * GET `/payments/:id` — detail; a cross-merchant id 404s server-side.
 * Disabled until `id` is known so React Query does not fire with `undefined`.
 */
export function usePayment(id: string | undefined) {
  return useEffectQuery<PaymentDetailResponse, ApiError>({
    queryKey: ["payments", "detail", id ?? null],
    query: () => paymentsApi.detail(id ?? ""),
    enabled: id !== undefined,
  });
}
