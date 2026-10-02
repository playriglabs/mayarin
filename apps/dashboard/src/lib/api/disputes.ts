/**
 * Disputes API (#313) — Mayarin Resolution's console. Needs the platform
 * permission `disputes:arbitrate`; every other account gets a 403.
 */

import type { Effect } from "effect";
import { type ApiError, request } from "@/lib/api/client";
import type { DisputeCaseDto, DisputeDto, DisputeMessageDto } from "@/types/payment";

export const disputesApi = {
  /** GET `/disputes` — open disputes this deployment arbitrates, nearest deadline first. */
  list: (): Effect.Effect<{ disputes: readonly DisputeDto[] }, ApiError> =>
    request<{ disputes: readonly DisputeDto[] }>("/disputes"),

  /** GET `/disputes/:id` — the case file, thread and live escrow. */
  get: (id: string): Effect.Effect<DisputeCaseDto, ApiError> =>
    request<DisputeCaseDto>(`/disputes/${encodeURIComponent(id)}`),

  /** POST `/disputes/:id/messages` — the arbiter's message. */
  message: (id: string, body: string): Effect.Effect<{ message: DisputeMessageDto }, ApiError> =>
    request<{ message: DisputeMessageDto }>(`/disputes/${encodeURIComponent(id)}/messages`, {
      method: "POST",
      body: { body },
    }),

  /** GET `/disputes/:id/resolve` — the split call for the arbiter's wallet (#315). */
  resolveCall: (
    id: string,
    payeeBps: number,
  ): Effect.Effect<{ readonly to: string; readonly data: string }, ApiError> =>
    request<{ readonly to: string; readonly data: string }>(
      `/disputes/${encodeURIComponent(id)}/resolve?payeeBps=${payeeBps}`,
    ),

  /** GET `/escrow-disputes` — the caller's merchant's own disputes, with the open count. */
  forMerchant: (): Effect.Effect<
    { readonly disputes: readonly DisputeDto[]; readonly open: number },
    ApiError
  > => request<{ disputes: readonly DisputeDto[]; open: number }>("/escrow-disputes"),

  /** GET `/escrow-disputes/:id` — one of the merchant's own disputes, with its thread. */
  merchantCase: (id: string): Effect.Effect<DisputeCaseDto, ApiError> =>
    request<DisputeCaseDto>(`/escrow-disputes/${encodeURIComponent(id)}`),
};
