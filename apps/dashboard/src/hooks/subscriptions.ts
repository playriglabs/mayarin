/** Subscription hooks (#296). Mirror `lib/api/subscriptions` one-to-one. */

import type { ApiError } from "@/lib/api/client";
import { subscriptionsApi } from "@/lib/api/subscriptions";
import { useEffectMutation, useEffectQuery } from "@/lib/query";
import type {
  CreateSubscriptionRequest,
  SubscriptionAction,
  SubscriptionDetailResponse,
  SubscriptionListResponse,
  SubscriptionResponse,
} from "@/types/subscriptions";

const SUBSCRIPTIONS_KEY = ["subscriptions"];

export function useSubscriptions() {
  return useEffectQuery<SubscriptionListResponse, ApiError>({
    queryKey: SUBSCRIPTIONS_KEY,
    query: subscriptionsApi.list,
    // The billing tick runs every minute; a due cycle shows up without a reload.
    refetchInterval: 60_000,
  });
}

export function useSubscriptionDetail(id: string | null) {
  return useEffectQuery<SubscriptionDetailResponse, ApiError>({
    queryKey: [...SUBSCRIPTIONS_KEY, id],
    query: () => subscriptionsApi.detail(id ?? ""),
    enabled: id !== null,
  });
}

export function useCreateSubscription() {
  return useEffectMutation<SubscriptionResponse, CreateSubscriptionRequest, ApiError>({
    mutation: subscriptionsApi.create,
    toast: { loading: "Creating subscription…", success: "Subscription created" },
    invalidate: [SUBSCRIPTIONS_KEY],
  });
}

export function useSubscriptionAction() {
  return useEffectMutation<
    SubscriptionResponse,
    { readonly id: string; readonly action: SubscriptionAction },
    ApiError
  >({
    mutation: subscriptionsApi.act,
    toast: { loading: "Updating subscription…", success: "Subscription updated" },
    invalidate: [SUBSCRIPTIONS_KEY],
  });
}
