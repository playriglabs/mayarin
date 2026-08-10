/**
 * Settlement hooks — the payout side of `/payments`. Mirrors
 * `lib/api/settlements` one-to-one.
 */

import type { ApiError } from "@/lib/api/client";
import { settlementsApi } from "@/lib/api/settlements";
import { useEffectQuery } from "@/lib/query";
import type { SettlementListResponse } from "@/types/settlement";

/** Terminal clearing states — nothing about these rows will change again. */
const SETTLED_STATES: readonly string[] = ["SUCCESS", "FAILED"];

/**
 * A row that is not terminal but is not going to move either.
 *
 * A payer who walks away leaves the clearing transaction parked at
 * `PAYMENT_PENDING`: the intent expires, the clearing row does not follow it.
 * Polling on the clearing state alone means one abandoned payment in the page
 * keeps a five-second poll running for as long as the tab is open, so the
 * intent's own expiry is what decides.
 */
function isAbandoned(expiresAt: string, now: number): boolean {
  return Date.parse(expiresAt) <= now;
}

export function useSettlements(limit?: number) {
  return useEffectQuery<SettlementListResponse, ApiError>({
    queryKey: ["settlements", "list", limit ?? null],
    query: () => settlementsApi.list(limit),
    // Polls only while something can still move, and stops once nothing can.
    refetchInterval: (data) => {
      const now = Date.now();
      const live = (data?.settlements ?? []).some(
        (s) => !SETTLED_STATES.includes(s.state) && !isAbandoned(s.expiresAt, now),
      );
      return live ? 5_000 : false;
    },
  });
}
