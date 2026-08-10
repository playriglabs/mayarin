/**
 * Payments API — read-only surface over `/payments`. Returns `Effect`s; never
 * calls `fetch` directly. Every account is merchant-scoped, so `/payments`
 * already returns only the caller's own merchant; there is no cross-merchant
 * list endpoint.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type { DepositResponse, PaymentDetailResponse, PaymentListResponse } from "@/types/payment";

function withLimit(path: string, limit?: number): string {
  return limit === undefined ? path : `${path}?limit=${limit}`;
}

export const paymentsApi = {
  /** GET `/payments` — the caller's own merchant only. */
  list: (limit?: number): Effect.Effect<PaymentListResponse, ApiError> =>
    request<PaymentListResponse>(withLimit("/payments", limit)),

  /** GET `/payments/:id` — detail; a cross-merchant id 404s server-side. */
  detail: (id: string): Effect.Effect<PaymentDetailResponse, ApiError> =>
    request<PaymentDetailResponse>(`/payments/${encodeURIComponent(id)}`),

  /** GET `/payments/:id/deposit` — what the payer must send, for the QR. */
  deposit: (id: string): Effect.Effect<DepositResponse, ApiError> =>
    request<DepositResponse>(`/payments/${encodeURIComponent(id)}/deposit`),
};
