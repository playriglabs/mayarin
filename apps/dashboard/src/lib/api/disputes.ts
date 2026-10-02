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
};
