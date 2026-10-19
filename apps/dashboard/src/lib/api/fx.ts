import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";

export const fxApi = {
  /** GET `/fx/currencies` — public: the register form asks before there is an account. */
  currencies: (): Effect.Effect<{ readonly currencies: readonly string[] }, ApiError> =>
    request<{ readonly currencies: readonly string[] }>("/fx/currencies"),
};
