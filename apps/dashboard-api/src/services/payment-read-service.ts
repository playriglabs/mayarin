/**
 * Payment read application service.
 *
 * The dashboard's read surface over payments. Every method takes the caller's
 * `Scope` and is ALWAYS scoped to that merchant — there is no cross-merchant
 * view. A request for another merchant's payment resolves to the same
 * `NotFoundError` an absent id would, so a not-found and a forbidden are
 * indistinguishable on the wire (no leakage).
 *
 * Reads straight off the `PaymentIntentRepository` and a narrow clearing read
 * port. It deliberately does not construct a `ClearingEngine`: the dashboard has
 * no write path, so pulling in the settlement/ledger/rates stack just to read
 * would couple it to the whole payment pipeline for nothing. The clearing port
 * is structural — `DrizzleClearingRepository` already satisfies it.
 */

import type { ClearingEvent, ClearingTransaction } from "@mayarin/clearing";
import type {
  ListPaymentIntentsOptions,
  PaymentIntent,
  PaymentIntentRepository,
} from "@mayarin/payment-intent";
import { NotFoundError } from "@mayarin/shared";
import type { Scope } from "../dto/auth.ts";
import { cursorPage, decodeCursor } from "../pagination.ts";

/** The slice of `ClearingRepository` a read-only dashboard needs. */
export interface ClearingReadRepository {
  findByPaymentIntentId(paymentIntentId: string): Promise<ClearingTransaction | null>;
  listEvents(clearingTransactionId: string): Promise<readonly ClearingEvent[]>;
}

export interface PaymentReadServiceOptions {
  readonly intents: PaymentIntentRepository;
  readonly clearing: ClearingReadRepository;
  readonly pageSize: number;
}

export interface PaymentDetail {
  readonly intent: PaymentIntent;
  readonly transaction: ClearingTransaction | null;
  readonly events: readonly ClearingEvent[];
}

export interface PaymentListFilter {
  readonly limit?: number;
  readonly q?: string;
  readonly status?: PaymentIntent["status"];
  readonly sort?: NonNullable<ListPaymentIntentsOptions["sort"]>;
  readonly from?: Date;
  readonly to?: Date;
  readonly cursor?: string;
}

export interface PaymentPage {
  readonly items: readonly PaymentIntent[];
  readonly nextCursor: string | null;
}

export type PaymentListAllFilter = Omit<PaymentListFilter, "limit" | "cursor">;

export class PaymentReadService {
  readonly #intents: PaymentIntentRepository;
  readonly #clearing: ClearingReadRepository;
  readonly #pageSize: number;

  constructor(options: PaymentReadServiceOptions) {
    this.#intents = options.intents;
    this.#clearing = options.clearing;
    this.#pageSize = options.pageSize;
  }

  /** Lists the caller's own intents, newest-first. */
  async list(scope: Scope, filter: PaymentListFilter = {}): Promise<PaymentPage> {
    const limit = Math.min(filter.limit ?? this.#pageSize, this.#pageSize);
    const cursor = decodeCursor(filter.cursor);
    const options: ListPaymentIntentsOptions = {
      limit: limit + 1,
      merchantId: scope.merchantId,
      ...(filter.q === undefined ? {} : { q: filter.q }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.sort === undefined ? {} : { sort: filter.sort }),
      ...(filter.from === undefined ? {} : { from: filter.from }),
      ...(filter.to === undefined ? {} : { to: filter.to }),
      ...(cursor === undefined ? {} : { cursor }),
    };
    const rows = await this.#intents.list(options);
    return cursorPage(rows, limit, (last) => ({
      id: last.id,
      createdAt: last.createdAt,
      ...(options.sort === "-amount" ? { amount: last.amount.amount } : {}),
    }));
  }

  async listAll(
    scope: Scope,
    filter: PaymentListAllFilter = {},
  ): Promise<readonly PaymentIntent[]> {
    const items: PaymentIntent[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.list(scope, {
        ...filter,
        ...(cursor === undefined ? {} : { cursor }),
      });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    return items;
  }

  /**
   * One payment view. A request for another merchant's payment gets the same
   * `NotFoundError` as a missing id — the scope check is after the load so a
   * not-found and a forbidden are indistinguishable on the wire.
   */
  async get(scope: Scope, id: string): Promise<PaymentDetail> {
    const intent = await this.#intents.findById(id);
    if (intent === null) throw new NotFoundError(`Payment ${id} not found`, { id });
    if (intent.merchant.id !== scope.merchantId) {
      throw new NotFoundError(`Payment ${id} not found`, { id });
    }

    const transaction = await this.#clearing.findByPaymentIntentId(intent.id);
    const events = transaction === null ? [] : await this.#clearing.listEvents(transaction.id);
    return { intent, transaction, events };
  }
}
