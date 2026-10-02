/**
 * Payments API — surface over `/payments`. Returns `Effect`s; never calls
 * `fetch` directly. Every account is merchant-scoped, so `/payments` already
 * returns only the caller's own merchant; there is no cross-merchant list
 * endpoint.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import { listPath } from "@/lib/api/list-path";
import type {
  DepositResponse,
  DisputeMessageDto,
  EscrowRefundResponse,
  EscrowResponse,
  PaymentDetailResponse,
  PaymentListFilter,
  PaymentListResponse,
} from "@/types/payment";

export const paymentsApi = {
  /** GET `/payments` — the caller's own merchant only. */
  list: (
    filter: PaymentListFilter = {},
    cursor?: string,
  ): Effect.Effect<PaymentListResponse, ApiError> =>
    request<PaymentListResponse>(listPath("/payments", filter, cursor)),

  /** GET `/payments/:id` — detail; a cross-merchant id 404s server-side. */
  detail: (id: string): Effect.Effect<PaymentDetailResponse, ApiError> =>
    request<PaymentDetailResponse>(`/payments/${encodeURIComponent(id)}`),

  /** GET `/payments/:id/deposit` — what the payer must send, for the QR. */
  deposit: (id: string): Effect.Effect<DepositResponse, ApiError> =>
    request<DepositResponse>(`/payments/${encodeURIComponent(id)}/deposit`),

  /**
   * POST `/payments/:id/retry` — reopen a payment that failed after the payer's
   * funds arrived, so the ordinary steps can settle it. A payment that must not
   * be retried answers with the reason.
   */
  retry: (id: string): Effect.Effect<void, ApiError> =>
    request<void>(`/payments/${encodeURIComponent(id)}/retry`, { method: "POST" }),

  /** GET `/payments/:id/escrow` — where an escrowed payment's funds are (#304). */
  escrow: (id: string): Effect.Effect<EscrowResponse, ApiError> =>
    request<EscrowResponse>(`/payments/${encodeURIComponent(id)}/escrow`),

  /** POST `/payments/:id/escrow/refund` — the refund transaction for `from` to send. */
  escrowRefund: (id: string, from: string): Effect.Effect<EscrowRefundResponse, ApiError> =>
    request<EscrowRefundResponse>(`/payments/${encodeURIComponent(id)}/escrow/refund`, {
      method: "POST",
      body: { from },
    }),

  /** POST `/payments/:id/escrow/dispute/messages` — the merchant's answer in a dispute (#313). */
  disputeMessage: (
    id: string,
    body: string,
  ): Effect.Effect<{ message: DisputeMessageDto }, ApiError> =>
    request<{ message: DisputeMessageDto }>(
      `/payments/${encodeURIComponent(id)}/escrow/dispute/messages`,
      { method: "POST", body: { body } },
    ),
};
