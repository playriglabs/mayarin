/**
 * x402 resources client — what the merchant sells to an agent (#208).
 *
 * `rails` is a read of what this merchant can be paid on today, and creation
 * names chains from that list. No call here carries a payout address: the
 * dashboard API fills it from the merchant's own verified wallet, which is what
 * keeps a typo from redirecting every payment on a rail.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type {
  CreateX402ResourceRequest,
  UpdateX402ResourceRequest,
  X402RailsResponse,
  X402ResourceListResponse,
  X402ResourceResponse,
} from "@/types/x402";

export const x402Api = {
  list: (): Effect.Effect<X402ResourceListResponse, ApiError> =>
    request<X402ResourceListResponse>("/x402-resources"),

  rails: (): Effect.Effect<X402RailsResponse, ApiError> =>
    request<X402RailsResponse>("/x402-resources/rails"),

  create: (body: CreateX402ResourceRequest): Effect.Effect<X402ResourceResponse, ApiError> =>
    request<X402ResourceResponse>("/x402-resources", { method: "POST", body }),

  /** Edits an endpoint in place. The id is the path, never the body. */
  update: (
    id: string,
    body: UpdateX402ResourceRequest,
  ): Effect.Effect<X402ResourceResponse, ApiError> =>
    request<X402ResourceResponse>(`/x402-resources/${encodeURIComponent(id)}`, {
      method: "PUT",
      body,
    }),

  /** Withdraws an endpoint. Nothing already paid is undone. */
  remove: (id: string): Effect.Effect<void, ApiError> =>
    request<void>(`/x402-resources/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
