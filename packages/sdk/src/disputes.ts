/**
 * The merchant surface for escrow disputes (#313): read the disputes buyers open
 * on your escrowed payments, read each thread, and answer.
 *
 * Pair it with the webhooks `escrow.disputed`, `escrow.dispute.message` and
 * `escrow.dispute.resolved`: they tell you when to look, so you can answer or
 * refund before an arbiter has to decide. Reading needs a key with
 * `payments:read`; answering needs `disputes:manage`.
 */

import type {
  DisputeCaseDto,
  DisputeListDto,
  DisputeMessageDto,
  DisputeStatus,
} from "@mayarin/api/dto";
import type { RequestOptions, Transport } from "./transport.ts";

export interface ListDisputesOptions extends RequestOptions {
  /** Only disputes in this status; `open` is the ones still waiting for a decision. */
  readonly status?: DisputeStatus;
  /** 1 to 100; default 50. Newest first. */
  readonly limit?: number;
}

export interface DisputesModule {
  /** `GET /disputes` — this merchant's disputes, newest first, and how many are open. */
  readonly list: (options?: ListDisputesOptions) => Promise<DisputeListDto>;
  /** `GET /disputes/:id` — one dispute with its thread, oldest message first. */
  readonly get: (id: string, options?: RequestOptions) => Promise<DisputeCaseDto>;
  /**
   * `POST /disputes/:id/messages` — answer in the thread: evidence of delivery, or
   * an offer to refund. Accepted only while the dispute is open.
   */
  readonly reply: (
    id: string,
    body: string,
    options?: RequestOptions,
  ) => Promise<DisputeMessageDto>;
}

function disputePath(id: string): string {
  return `/disputes/${encodeURIComponent(id)}`;
}

export function createDisputesModule(transport: Transport): DisputesModule {
  return {
    list: ({ status, limit, ...options } = {}) =>
      transport.get<DisputeListDto>("/disputes", {
        ...options,
        query: {
          ...(options.query ?? {}),
          ...(status === undefined ? {} : { status }),
          ...(limit === undefined ? {} : { limit }),
        },
      }),
    get: async (id, options) =>
      (await transport.get<{ dispute: DisputeCaseDto }>(disputePath(id), options)).dispute,
    reply: async (id, body, options) =>
      (
        await transport.post<{ message: DisputeMessageDto }>(
          `${disputePath(id)}/messages`,
          { body },
          options,
        )
      ).message,
  };
}
