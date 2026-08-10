import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type { AnalyticsResponse } from "@/types/analytics";

export const analyticsApi = {
  get: (): Effect.Effect<AnalyticsResponse, ApiError> => request<AnalyticsResponse>("/analytics"),
};
