/**
 * Event log service — the merchant's unified timeline.
 *
 * A thin read over `MerchantEventRepository`: the scope's `merchantId` is the
 * only filter, applied at the source so the three bounded queries underneath
 * can only ever reach this merchant's rows. No ownership check beyond that —
 * there is no per-row foreign key to verify, the way there is for a customer or
 * a webhook endpoint. The service exists to keep the route thin and to give the
 * container one thing to wire.
 */

import type {
  MerchantEventFilter,
  MerchantEventRepository,
  MerchantEventRow,
} from "@mayarin/compliance";
import type { Scope } from "../dto/auth.ts";
import { cursorPage, DEFAULT_PAGE_SIZE, decodeCursor } from "../pagination.ts";

export interface EventLogServiceOptions {
  readonly events: MerchantEventRepository;
}

export interface EventLogListFilter extends Omit<MerchantEventFilter, "cursor"> {
  readonly limit?: number;
  readonly cursor?: string;
}

export interface EventLogPage {
  readonly items: readonly MerchantEventRow[];
  readonly nextCursor: string | null;
}

export class EventLogService {
  readonly #events: MerchantEventRepository;

  constructor(options: EventLogServiceOptions) {
    this.#events = options.events;
  }

  async list(scope: Scope, filter: EventLogListFilter = {}): Promise<EventLogPage> {
    const limit = Math.min(filter.limit ?? DEFAULT_PAGE_SIZE, 200);
    const cursor = decodeCursor(filter.cursor);
    const rows = await this.#events.listByMerchant(scope.merchantId, limit + 1, {
      ...(filter.q === undefined ? {} : { q: filter.q }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.sort === undefined ? {} : { sort: filter.sort }),
      ...(filter.from === undefined ? {} : { from: filter.from }),
      ...(filter.to === undefined ? {} : { to: filter.to }),
      ...(cursor === undefined ? {} : { cursor: { id: cursor.id, occurredAt: cursor.createdAt } }),
    });
    return cursorPage(rows, limit, (last) => ({ id: last.id, createdAt: last.occurredAt }));
  }
}
