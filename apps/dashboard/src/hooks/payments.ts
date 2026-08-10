/**
 * Payment hooks — one React Query hook per `/payments` route. Components
 * consume `const payments = usePayments()` and read `payments.data`; they never
 * touch `useEffectQuery` or `paymentsApi` directly. Mirrors `lib/api/payments`
 * one-to-one.
 *
 * Both hooks poll while a payment can still move and stop once none can. A
 * payment clears in seconds and a merchant watching one arrive should not have
 * to reload the page; a merchant reading last week's payments should not be
 * generating traffic for rows that will never change again. The hosted checkout
 * has a real event stream (#13) — this side does not, and a poll that switches
 * itself off is the honest version of live rather than a pretence of one.
 */

import type { ApiError } from "@/lib/api/client";
import { paymentsApi } from "@/lib/api/payments";
import { useLiveChannel } from "@/lib/live-updates";
import { useEffectQuery } from "@/lib/query";
import type {
  DepositResponse,
  PaymentDetailResponse,
  PaymentIntentStatus,
  PaymentListFilter,
  PaymentListResponse,
} from "@/types/payment";

/** Statuses after which nothing further will ever happen to an intent. */
const TERMINAL_STATUSES: readonly PaymentIntentStatus[] = ["COMPLETED", "FAILED", "EXPIRED"];

const POLL_MS = 5_000;

function isLive(status: PaymentIntentStatus): boolean {
  return !TERMINAL_STATUSES.includes(status);
}

/** GET `/payments` — the caller's own merchant only. */
export function usePayments(limit?: number) {
  const isStreamConnected = useLiveChannel("payments");
  return useEffectQuery<PaymentListResponse, ApiError>({
    queryKey: ["payments", "list", limit ?? null],
    query: () => paymentsApi.list(limit === undefined ? {} : { limit }),
    refetchInterval: (data) =>
      !isStreamConnected && (data?.payments ?? []).some((payment) => isLive(payment.status))
        ? POLL_MS
        : false,
  });
}

export function usePaymentPage(filter: PaymentListFilter, cursor?: string) {
  const isStreamConnected = useLiveChannel("payments");
  return useEffectQuery<PaymentListResponse, ApiError>({
    queryKey: ["payments", "list", filter, cursor ?? null],
    query: () => paymentsApi.list(filter, cursor),
    refetchInterval: (data) =>
      !isStreamConnected && (data?.payments ?? []).some((payment) => isLive(payment.status))
        ? POLL_MS
        : false,
  });
}

/**
 * GET `/payments/:id` — detail; a cross-merchant id 404s server-side.
 * Disabled until `id` is known so React Query does not fire with `undefined`.
 */
export function usePayment(id: string | undefined) {
  const isStreamConnected = useLiveChannel("payments");
  return useEffectQuery<PaymentDetailResponse, ApiError>({
    queryKey: ["payments", "detail", id ?? null],
    query: () => paymentsApi.detail(id ?? ""),
    enabled: id !== undefined,
    refetchInterval: (data) => {
      const status = data?.paymentIntent.status;
      return !isStreamConnected && status !== undefined && isLive(status) ? POLL_MS : false;
    },
  });
}

/**
 * What the payer must send — the address, the exact amount, and the EIP-681 URI
 * to render as a QR.
 *
 * Polls while the deposit is unfunded: the address is allocated at price lock,
 * so it can arrive a moment after the payment does, and the received total
 * moves as transfers confirm. Stops once the full amount has landed.
 */
export function useDeposit(id: string | undefined) {
  return useEffectQuery<DepositResponse, ApiError>({
    queryKey: ["payments", "deposit", id ?? null],
    query: () => paymentsApi.deposit(id ?? ""),
    enabled: id !== undefined,
    refetchInterval: (data) => {
      const deposit = data?.deposit;
      if (deposit === undefined) return POLL_MS;
      if (deposit === null) return false;
      return BigInt(deposit.received.amount) < BigInt(deposit.amount.amount) ? POLL_MS : false;
    },
  });
}
