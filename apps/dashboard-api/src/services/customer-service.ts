/**
 * Merchant-managed customer directory.
 *
 * The merchant knows who their customers are; Mayarin does not. This service is
 * the CRUD behind that directory, scoped to the caller's merchant the same way
 * the webhook and catalog services are: every method takes a `Scope` and reads
 * `scope.merchantId` from it, and a customer belonging to another merchant
 * resolves to the same `NotFoundError` an absent id would.
 *
 * A customer links to payments through `metadata.customerId`, stamped at intent
 * creation. `detail` reads that link back: the customer's orders (assembled by
 * `OrderReadService`) and their completed volume.
 */

import {
  type Customer,
  type CustomerRepository,
  createCustomer,
  updateCustomer,
} from "@mayarin/catalog";
import { type AssetCode, type Clock, type Money, NotFoundError } from "@mayarin/shared";
import type { Scope } from "../dto/auth.ts";
import type { OrderReadService } from "./order-read-service.ts";

export interface CustomerServiceOptions {
  readonly customers: CustomerRepository;
  /** Reads the customer's linked orders for `detail`. */
  readonly orders: OrderReadService;
  readonly clock: Clock;
  readonly pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 100;

export interface CreateCustomerInput {
  readonly name: string;
  readonly email?: string;
  readonly notes?: string;
}

export type UpdateCustomerInput = Parameters<typeof updateCustomer>[1];

export interface CustomerDetail {
  readonly customer: Customer;
  readonly orders: Awaited<ReturnType<OrderReadService["listByCustomer"]>>;
  readonly lifetimeValue: Money | null;
}

export class CustomerService {
  readonly #customers: CustomerRepository;
  readonly #orders: OrderReadService;
  readonly #clock: Clock;
  readonly #pageSize: number;

  constructor(options: CustomerServiceOptions) {
    this.#customers = options.customers;
    this.#orders = options.orders;
    this.#clock = options.clock;
    this.#pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  }

  async list(scope: Scope, limit?: number): Promise<readonly Customer[]> {
    return this.#customers.listByMerchant({
      merchantId: scope.merchantId,
      limit: Math.min(limit ?? this.#pageSize, this.#pageSize),
    });
  }

  async get(scope: Scope, id: string): Promise<Customer> {
    return this.#ownCustomer(scope, id);
  }

  async create(scope: Scope, input: CreateCustomerInput): Promise<Customer> {
    const customer = createCustomer({
      ...input,
      merchantId: scope.merchantId,
      now: this.#clock.now(),
    });
    await this.#customers.insert(customer);
    return customer;
  }

  async update(scope: Scope, id: string, patch: UpdateCustomerInput): Promise<Customer> {
    const current = await this.#ownCustomer(scope, id);
    const updated = updateCustomer(current, patch, this.#clock.now());
    await this.#customers.update(updated, current.version);
    return updated;
  }

  async delete(scope: Scope, id: string): Promise<void> {
    await this.#ownCustomer(scope, id);
    await this.#customers.delete(id);
  }

  async detail(scope: Scope, id: string): Promise<CustomerDetail> {
    const customer = await this.#ownCustomer(scope, id);
    const orders = await this.#orders.listByCustomer(scope, id);
    return { customer, orders, lifetimeValue: lifetimeValue(orders) };
  }

  async #ownCustomer(scope: Scope, id: string): Promise<Customer> {
    const customer = await this.#customers.findById(id);
    if (customer === null || customer.merchantId !== scope.merchantId) {
      throw new NotFoundError(`Customer ${id} not found`, { id });
    }
    return customer;
  }
}

/**
 * The customer's completed order volume, in the currency of their first
 * completed order. Sums across currencies would mix assets into a number that
 * means nothing, so one currency is reported and the rest are excluded — a
 * customer almost always pays in one currency anyway.
 */
function lifetimeValue(
  orders: readonly { readonly intent: { readonly status: string; readonly amount: Money } }[],
): Money | null {
  let sum = 0n;
  let asset: AssetCode | undefined;
  for (const order of orders) {
    if (order.intent.status !== "COMPLETED") continue;
    if (asset === undefined) asset = order.intent.amount.asset;
    if (order.intent.amount.asset !== asset) continue;
    sum += order.intent.amount.amount;
  }
  if (asset === undefined) return null;
  return { amount: sum, asset };
}
