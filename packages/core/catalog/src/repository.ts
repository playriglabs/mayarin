/**
 * Persistence ports for the commerce layer.
 *
 * The domain owns these contracts; adapters (Drizzle, in-memory) implement
 * them. `update` takes the version the caller read, so a lost update surfaces
 * as a `ConcurrencyError` instead of overwriting another writer's edit.
 */

import type { Customer, PaymentLink, Product } from "./types.ts";

export interface ListProductsOptions {
  readonly merchantId: string;
  /** Omitted, both active and retired products are listed. */
  readonly active?: boolean;
  readonly limit?: number;
  readonly cursor?: { readonly id: string; readonly createdAt: Date };
}

export interface ProductRepository {
  insert(product: Product): Promise<void>;
  findById(id: string): Promise<Product | null>;
  /** Resolves several ids in one round trip — what cart pricing needs. */
  findManyById(ids: readonly string[]): Promise<readonly Product[]>;
  findBySku(merchantId: string, sku: string): Promise<Product | null>;
  update(product: Product, expectedVersion: number): Promise<void>;
  list(options: ListProductsOptions): Promise<readonly Product[]>;
}

export interface ListPaymentLinksOptions {
  readonly merchantId: string;
  readonly limit?: number;
  readonly cursor?: { readonly id: string; readonly createdAt: Date };
}

/**
 * The bounded, newest-first read behind the public x402 payable index (#273) —
 * cross-merchant, keyset-paginated, same cursor shape as the merchant listing.
 */
export interface ListListedLinksOptions {
  readonly limit: number;
  readonly cursor?: { readonly id: string; readonly createdAt: Date };
}

export interface PaymentLinkRepository {
  insert(link: PaymentLink): Promise<void>;
  findById(id: string): Promise<PaymentLink | null>;
  findByIdempotencyKey(key: string): Promise<PaymentLink | null>;
  update(link: PaymentLink, expectedVersion: number): Promise<void>;
  list(options: ListPaymentLinksOptions): Promise<readonly PaymentLink[]>;
  /** Listed links across every merchant, newest first, keyset-paginated. */
  listListed(options: ListListedLinksOptions): Promise<readonly PaymentLink[]>;
}

export interface ListCustomersOptions {
  readonly merchantId: string;
  readonly q?: string;
  readonly sort?: "created" | "-created";
  readonly from?: Date;
  readonly to?: Date;
  readonly limit?: number;
}

export interface CustomerRepository {
  insert(customer: Customer): Promise<void>;
  findById(id: string): Promise<Customer | null>;
  listByMerchant(options: ListCustomersOptions): Promise<readonly Customer[]>;
  update(customer: Customer, expectedVersion: number): Promise<void>;
  delete(id: string): Promise<void>;
}
