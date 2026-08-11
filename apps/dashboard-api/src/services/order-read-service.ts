/**
 * Order read service.
 *
 * An order is a commerce view of a payment: the same `PaymentIntent` the
 * payments surface reads, shown with its line items and the customer it was
 * taken for. Nothing is written here — the order is assembled from the intent's
 * frozen `metadata.cart` snapshot and `merchantReference`, both of which the
 * payment API already persists.
 *
 * Reads only the caller's own intents. The scope filter is applied once at the
 * source (`PaymentIntentRepository.list`), and the customer resolve that
 * follows only ever looks up an id already inside that merchant's metadata.
 */

import {
  CART_METADATA_KEY,
  type CartLine,
  type CartSnapshot,
  type Customer,
  type CustomerRepository,
  parseCartSnapshot,
} from "@mayarin/catalog";
import {
  isExpired,
  type PaymentIntent,
  type PaymentIntentRepository,
} from "@mayarin/payment-intent";
import { type Clock, type Money, money, NotFoundError } from "@mayarin/shared";
import type { Scope } from "../dto/auth.ts";
import { DEFAULT_PAGE_SIZE, decodeCursor, encodeCursor } from "../pagination.ts";
import type { PaymentListFilter } from "./payment-read-service.ts";

export interface OrderReadServiceOptions {
  readonly intents: PaymentIntentRepository;
  readonly customers: CustomerRepository;
  /** Caps a listing; the route's own limit is clamped to it. */
  readonly pageSize?: number;
  readonly clock: Clock;
}

/** One row of the order view: a payment, its parsed lines, and its customer. */
export interface OrderRow {
  readonly intent: PaymentIntent;
  /** The total the lines fold to — `intent.amount`, read from the source of truth. */
  readonly total: Money;
  readonly lines: readonly CartLine[];
  /** The customer this order was taken for, if `metadata.customerId` resolves to one of the merchant's own. */
  readonly customer: Pick<Customer, "id" | "name"> | undefined;
}

export interface OrderPage {
  readonly items: readonly OrderRow[];
  readonly nextCursor: string | null;
}

export class OrderReadService {
  readonly #intents: PaymentIntentRepository;
  readonly #customers: CustomerRepository;
  readonly #pageSize: number;
  readonly #clock: Clock;

  constructor(options: OrderReadServiceOptions) {
    this.#intents = options.intents;
    this.#customers = options.customers;
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    this.#clock = options.clock;
  }

  /** Read-only expiry projection — see `PaymentReadService.#withExpiredView`. */
  #withExpiredView(intent: PaymentIntent): PaymentIntent {
    return isExpired(intent, this.#clock.now()) ? { ...intent, status: "EXPIRED" } : intent;
  }

  /**
   * The caller's own orders, newest-first.
   *
   * An order is an intent that carries a cart snapshot or a merchant reference;
   * a payment with neither is a plain transfer the payments surface already
   * shows, and listing it here too would be a second copy of the same table.
   */
  async list(scope: Scope, filter: PaymentListFilter = {}): Promise<OrderPage> {
    const limit = Math.min(filter.limit ?? this.#pageSize, this.#pageSize);
    const cursor = decodeCursor(filter.cursor);
    const intents = await this.#intents.list({
      merchantId: scope.merchantId,
      limit: limit + 1,
      ...(filter.q === undefined ? {} : { q: filter.q }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.sort === undefined ? {} : { sort: filter.sort }),
      ...(filter.from === undefined ? {} : { from: filter.from }),
      ...(filter.to === undefined ? {} : { to: filter.to }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    const scanned = intents.slice(0, limit);
    const rows = await this.#toRows(scope, scanned);
    const last = scanned.at(-1);
    return {
      items: rows,
      nextCursor:
        intents.length <= limit || last === undefined
          ? null
          : encodeCursor({
              id: last.id,
              createdAt: last.createdAt,
              ...(filter.sort === "-amount" ? { amount: last.amount.amount } : {}),
            }),
    };
  }

  /**
   * The orders taken for one customer.
   *
   * `customerId` lives in `metadata`, which the intent repo does not index, so
   * the customer's orders are filtered from the merchant's page of intents in
   * memory. The page is bounded and the customer belongs to the caller or this
   * returns a 404 before any read.
   */
  async listByCustomer(
    scope: Scope,
    customerId: string,
    limit?: number,
  ): Promise<readonly OrderRow[]> {
    await this.#ownCustomer(scope, customerId);
    const intents = await this.#intents.list({
      merchantId: scope.merchantId,
      limit: Math.min(limit ?? this.#pageSize, this.#pageSize),
    });
    const forCustomer = intents.filter((intent) => intent.metadata?.customerId === customerId);
    return this.#toRows(scope, forCustomer);
  }

  async #toRows(scope: Scope, intents: readonly PaymentIntent[]): Promise<readonly OrderRow[]> {
    const customerIds = new Set<string>();
    for (const intent of intents) {
      const id = intent.metadata?.customerId;
      if (id !== undefined) customerIds.add(id);
    }
    const customers = new Map<string, Pick<Customer, "id" | "name">>();
    for (const id of customerIds) {
      const customer = await this.#customers.findById(id);
      // A customerId that does not resolve, or resolves to another merchant, is
      // not shown: a deleted customer leaves their orders behind, and a stale
      // id from before a merchant split is not this merchant's customer.
      if (customer !== null && customer.merchantId === scope.merchantId) {
        customers.set(id, { id: customer.id, name: customer.name });
      }
    }

    const rows: OrderRow[] = [];
    for (const intent of intents) {
      if (!isOrder(intent)) continue;
      const snapshot = cartSnapshotOf(intent);
      const lines = snapshot === undefined ? syntheticLine(intent) : toCartLines(snapshot);
      const customerId = intent.metadata?.customerId;
      rows.push({
        intent: this.#withExpiredView(intent),
        total: intent.amount,
        lines,
        customer: customerId === undefined ? undefined : customers.get(customerId),
      });
    }
    return rows;
  }

  async #ownCustomer(scope: Scope, customerId: string): Promise<Customer> {
    const customer = await this.#customers.findById(customerId);
    if (customer === null || customer.merchantId !== scope.merchantId) {
      throw new NotFoundError(`Customer ${customerId} not found`, { id: customerId });
    }
    return customer;
  }
}

/** An order is a payment that carries line items or a merchant reference. */
function isOrder(intent: PaymentIntent): boolean {
  return (
    intent.metadata?.[CART_METADATA_KEY] !== undefined || intent.merchantReference !== undefined
  );
}

function cartSnapshotOf(intent: PaymentIntent): CartSnapshot | undefined {
  const raw = intent.metadata?.[CART_METADATA_KEY];
  return raw === undefined ? undefined : parseCartSnapshot(raw);
}

function toCartLines(snapshot: CartSnapshot): readonly CartLine[] {
  return snapshot.lines.map((line) => ({
    ...(line.productId === undefined ? {} : { productId: line.productId }),
    name: line.name,
    unitPrice: money(BigInt(line.unitPrice), snapshot.currency),
    quantity: line.quantity,
  }));
}

/**
 * A referenced payment with no cart snapshot still renders as one line: the
 * merchant took it for a reference (an invoice, a table) rather than a cart,
 * and an order with a single "Payment" line is the honest representation.
 */
function syntheticLine(intent: PaymentIntent): readonly CartLine[] {
  return [{ name: "Payment", unitPrice: intent.amount, quantity: 1 }];
}
