/** Batch payouts API (#295). Returns `Effect`s; never calls `fetch` directly. */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import { listPath } from "@/lib/api/list-path";
import { PAGE_SIZE } from "@/lib/pagination";
import type {
  PayoutBatchResponse,
  PayoutHistoryResponse,
  PayoutRequest,
  PreparePayoutResponse,
} from "@/types/payouts";

export const payoutsApi = {
  /** Confirmed batches, newest first. */
  history: (cursor?: string): Effect.Effect<PayoutHistoryResponse, ApiError> =>
    request<PayoutHistoryResponse>(listPath("/payouts", { limit: PAGE_SIZE }, cursor)),

  /** Parses the file; returns every row error, or the transaction to sign. */
  prepare: (body: PayoutRequest): Effect.Effect<PreparePayoutResponse, ApiError> =>
    request<PreparePayoutResponse>("/payouts/prepare", { method: "POST", body }),

  /** Records a submitted batch once the chain's transfers match every row. */
  record: (
    body: PayoutRequest & { readonly transactionHash: string },
  ): Effect.Effect<PayoutBatchResponse, ApiError> =>
    request<PayoutBatchResponse>("/payouts", { method: "POST", body }),
};
