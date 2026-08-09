/**
 * Persistence ports for invoicing.
 *
 * The domain owns these contracts; adapters implement them. `update` takes the
 * version the caller read, so a lost update surfaces as a `ConcurrencyError`
 * rather than overwriting another writer's edit.
 */

import type { Invoice, InvoiceState } from "./types.ts";

export interface ListInvoicesOptions {
  readonly merchantId: string;
  readonly state?: InvoiceState;
  readonly limit?: number;
}

export interface InvoiceRepository {
  insert(invoice: Invoice): Promise<void>;
  findById(id: string): Promise<Invoice | null>;
  /** Resolves the number a buyer quotes back. Unique per merchant. */
  findByNumber(merchantId: string, number: string): Promise<Invoice | null>;
  findByIdempotencyKey(key: string): Promise<Invoice | null>;
  update(invoice: Invoice, expectedVersion: number): Promise<void>;
  list(options: ListInvoicesOptions): Promise<readonly Invoice[]>;
}

/**
 * Allocates the next counter value for a merchant.
 *
 * Deliberately the whole of the contract. Whether the implementation is gapless
 * — a counter row taken under a row lock inside the issuing transaction — or
 * gap-tolerant, like the deposit-address sequence already in this codebase, is
 * a property of the adapter and invisible here.
 *
 * A value is allocated exactly once and never reallocated, including when the
 * invoice it was allocated for is later voided.
 */
export interface InvoiceNumberAllocator {
  allocate(merchantId: string): Promise<number>;
}
