/** Subscriptions API (#296). Returns `Effect`s; never calls `fetch` directly. */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type {
  CreateSubscriptionRequest,
  SubscriptionAction,
  SubscriptionDetailResponse,
  SubscriptionListResponse,
  SubscriptionResponse,
} from "@/types/subscriptions";

export const subscriptionsApi = {
  list: (): Effect.Effect<SubscriptionListResponse, ApiError> =>
    request<SubscriptionListResponse>("/subscriptions"),

  detail: (id: string): Effect.Effect<SubscriptionDetailResponse, ApiError> =>
    request<SubscriptionDetailResponse>(`/subscriptions/${encodeURIComponent(id)}`),

  create: (body: CreateSubscriptionRequest): Effect.Effect<SubscriptionResponse, ApiError> =>
    request<SubscriptionResponse>("/subscriptions", { method: "POST", body }),

  act: ({
    id,
    action,
  }: {
    readonly id: string;
    readonly action: SubscriptionAction;
  }): Effect.Effect<SubscriptionResponse, ApiError> =>
    request<SubscriptionResponse>(`/subscriptions/${encodeURIComponent(id)}/${action}`, {
      method: "POST",
    }),
};
