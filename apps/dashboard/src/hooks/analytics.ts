import { analyticsApi } from "@/lib/api/analytics";
import type { ApiError } from "@/lib/api/client";
import { useEffectQuery } from "@/lib/query";
import type { AnalyticsResponse } from "@/types/analytics";

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "EXPIRED"]);

export function useAnalytics() {
  return useEffectQuery<AnalyticsResponse, ApiError>({
    queryKey: ["analytics"],
    query: analyticsApi.get,
    refetchInterval: (data) =>
      (data?.payments ?? []).some((payment) => !TERMINAL_STATUSES.has(payment.status))
        ? 5_000
        : false,
  });
}
