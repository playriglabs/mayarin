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
  async list(scope: Scope, limit?: number): Promise<readonly PaymentIntent[]> {
    const options: ListPaymentIntentsOptions = {
      limit: Math.min(limit ?? this.#pageSize, this.#pageSize),
      merchantId: scope.merchantId,
    };
    return this.#intents.list(options);
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
