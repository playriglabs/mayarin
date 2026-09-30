/** Batch payout hooks (#295). Mirror `lib/api/payouts` one-to-one. */

import type { ApiError } from "@/lib/api/client";
import { payoutsApi } from "@/lib/api/payouts";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type {
  PayoutBatchResponse,
  PayoutHistoryResponse,
  PayoutRequest,
  PreparePayoutResponse,
} from "@/types/payouts";

const PAYOUTS_KEY = ["payouts"];

export function usePayoutHistory(cursor?: string) {
  return useEffectQuery<PayoutHistoryResponse, ApiError>({
    queryKey: [...PAYOUTS_KEY, cursor ?? null],
    query: () => payoutsApi.history(cursor),
  });
}

export function usePreparePayout() {
  return useEffectMutation<PreparePayoutResponse, PayoutRequest, ApiError>({
    mutation: (body) => payoutsApi.prepare(body),
  });
}

export function useRecordPayout() {
  return useEffectMutation<
    PayoutBatchResponse,
    PayoutRequest & { readonly transactionHash: string },
    ApiError
  >({
    mutation: (body) => payoutsApi.record(body),
    invalidate: [PAYOUTS_KEY, ["wallets", "balance"]],
  });
}
