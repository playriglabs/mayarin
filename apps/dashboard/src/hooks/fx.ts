import type { ApiError } from "@/lib/api/client";
import { fxApi } from "@/lib/api/fx";
import { useEffectQuery } from "@/lib/query";

/** Currencies a merchant can read their money in. Empty when the rate source is down. */
export function useCurrencies() {
  return useEffectQuery<{ readonly currencies: readonly string[] }, ApiError>({
    queryKey: ["fx", "currencies"],
    query: fxApi.currencies,
  });
}
