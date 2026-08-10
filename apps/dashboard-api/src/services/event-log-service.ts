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

import type { MerchantEventRepository, MerchantEventRow } from "@mayarin/compliance";
import type { Scope } from "../dto/auth.ts";

export interface EventLogServiceOptions {
  readonly events: MerchantEventRepository;
}

export class EventLogService {
  readonly #events: MerchantEventRepository;

  constructor(options: EventLogServiceOptions) {
    this.#events = options.events;
  }

  async list(scope: Scope, limit?: number): Promise<readonly MerchantEventRow[]> {
    return this.#events.listByMerchant(scope.merchantId, limit);
  }
}
