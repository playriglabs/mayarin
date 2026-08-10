/**
 * Reference in-memory fakes for the commerce ports, shipped in a segregated
 * `/testing` subpath so domain `src/` stays pure.
 *
 * Mirrors the guarantees of the Postgres implementations — SKU uniqueness per
 * merchant, unique idempotency keys, optimistic locking — so tests exercise the
 * same failure modes without a database.
 */

import { ConcurrencyError, ConflictError } from "@mayarin/shared";
import type {
  Customer,
  CustomerRepository,
  ListCustomersOptions,
  ListPaymentLinksOptions,
  ListProductsOptions,
  PaymentLink,
  PaymentLinkRepository,
  Product,
  ProductRepository,
} from "../src/index.ts";

const DEFAULT_LIMIT = 100;

export class InMemoryProductRepository implements ProductRepository {
  readonly #byId = new Map<string, Product>();

  async insert(product: Product): Promise<void> {
    if (this.#byId.has(product.id)) {
      throw new ConflictError(`Product ${product.id} already exists`, { id: product.id });
    }
    if ((await this.findBySku(product.merchantId, product.sku)) !== null) {
      throw new ConflictError(`SKU "${product.sku}" is already in use`, {
        merchantId: product.merchantId,
        sku: product.sku,
      });
    }
    this.#byId.set(product.id, product);
  }

  async findById(id: string): Promise<Product | null> {
    return this.#byId.get(id) ?? null;
  }

  async findManyById(ids: readonly string[]): Promise<readonly Product[]> {
    return ids
      .map((id) => this.#byId.get(id))
      .filter((product): product is Product => product !== undefined);
  }

  async findBySku(merchantId: string, sku: string): Promise<Product | null> {
    for (const product of this.#byId.values()) {
      if (product.merchantId === merchantId && product.sku === sku) return product;
    }
    return null;
  }

  async update(product: Product, expectedVersion: number): Promise<void> {
    const current = this.#byId.get(product.id);
    if (current === undefined) {
      throw new ConflictError(`Product ${product.id} does not exist`, { id: product.id });
    }
    if (current.version !== expectedVersion) {
      throw new ConcurrencyError(`Product ${product.id} was modified concurrently`, {
        id: product.id,
        expectedVersion,
        actualVersion: current.version,
      });
    }
    this.#byId.set(product.id, product);
  }

  async list(options: ListProductsOptions): Promise<readonly Product[]> {
    return [...this.#byId.values()]
      .filter((product) => product.merchantId === options.merchantId)
      .filter((product) => options.active === undefined || product.active === options.active)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit ?? DEFAULT_LIMIT);
  }
}

export class InMemoryPaymentLinkRepository implements PaymentLinkRepository {
  readonly #byId = new Map<string, PaymentLink>();
  readonly #byIdempotencyKey = new Map<string, string>();

  async insert(link: PaymentLink): Promise<void> {
    if (this.#byId.has(link.id)) {
      throw new ConflictError(`Payment link ${link.id} already exists`, { id: link.id });
    }
    if (link.idempotencyKey !== undefined) {
      if (this.#byIdempotencyKey.has(link.idempotencyKey)) {
        throw new ConflictError(`Idempotency key "${link.idempotencyKey}" is already in use`, {
          idempotencyKey: link.idempotencyKey,
        });
      }
      this.#byIdempotencyKey.set(link.idempotencyKey, link.id);
    }
    this.#byId.set(link.id, link);
  }

  async findById(id: string): Promise<PaymentLink | null> {
    return this.#byId.get(id) ?? null;
  }

  async findByIdempotencyKey(key: string): Promise<PaymentLink | null> {
    const id = this.#byIdempotencyKey.get(key);
    return id === undefined ? null : (this.#byId.get(id) ?? null);
  }

  async update(link: PaymentLink, expectedVersion: number): Promise<void> {
    const current = this.#byId.get(link.id);
    if (current === undefined) {
      throw new ConflictError(`Payment link ${link.id} does not exist`, { id: link.id });
    }
    if (current.version !== expectedVersion) {
      throw new ConcurrencyError(`Payment link ${link.id} was modified concurrently`, {
        id: link.id,
        expectedVersion,
        actualVersion: current.version,
      });
    }
    this.#byId.set(link.id, link);
  }

  async list(options: ListPaymentLinksOptions): Promise<readonly PaymentLink[]> {
    return [...this.#byId.values()]
      .filter((link) => link.merchant.id === options.merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit ?? DEFAULT_LIMIT);
  }
}

export class InMemoryCustomerRepository implements CustomerRepository {
  readonly #byId = new Map<string, Customer>();

  async insert(customer: Customer): Promise<void> {
    if (this.#byId.has(customer.id)) {
      throw new ConflictError(`Customer ${customer.id} already exists`, { id: customer.id });
    }
    this.#byId.set(customer.id, customer);
  }

  async findById(id: string): Promise<Customer | null> {
    return this.#byId.get(id) ?? null;
  }

  async listByMerchant(options: ListCustomersOptions): Promise<readonly Customer[]> {
    return [...this.#byId.values()]
      .filter((customer) => customer.merchantId === options.merchantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit ?? DEFAULT_LIMIT);
  }

  async update(customer: Customer, expectedVersion: number): Promise<void> {
    const current = this.#byId.get(customer.id);
    if (current === undefined) {
      throw new ConflictError(`Customer ${customer.id} does not exist`, { id: customer.id });
    }
    if (current.version !== expectedVersion) {
      throw new ConcurrencyError(`Customer ${customer.id} was modified concurrently`, {
        id: customer.id,
        expectedVersion,
        actualVersion: current.version,
      });
    }
    this.#byId.set(customer.id, customer);
  }

  async delete(id: string): Promise<void> {
    if (!this.#byId.has(id)) {
      throw new ConflictError(`Customer ${id} does not exist`, { id });
    }
    this.#byId.delete(id);
  }
}
