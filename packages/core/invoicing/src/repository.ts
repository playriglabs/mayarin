/**
 * Persistence port for invoicing.
 *
 * The domain owns this contract; adapters implement it. `update` takes the
 * version the caller read, so a lost update surfaces as a `ConcurrencyError`
 * rather than overwriting another writer's edit.
 */

import type { Invoice, InvoiceState } from "./types.ts";

export interface ListInvoicesOptions {
  readonly merchantId: string;
  readonly state?: InvoiceState;
  readonly limit?: number;
}

/**
 * The bounded, newest-first read behind the public x402 payable index (#273).
 *
 * Cross-merchant on purpose: an agent that has never met a merchant is the
 * whole point. The keyset cursor matches the one the x402 resource listing
 * uses, so both indexes paginate identically.
 */
export interface ListListedInvoicesOptions {
  readonly limit: number;
  readonly cursor?: ListedInvoicesCursor;
}

export interface ListedInvoicesCursor {
  readonly id: string;
  readonly createdAt: Date;
}

/**
 * Turns a draft into an issued invoice, given the number it was allocated.
 *
 * Pure, and called by the adapter rather than before it — see `issue`.
 */
export type IssueWithSequence = (sequence: number) => Invoice;

export interface InvoiceRepository {
  insert(invoice: Invoice): Promise<void>;
  findById(id: string): Promise<Invoice | null>;
  /** Resolves the number a buyer quotes back. Unique per merchant. */
  findByNumber(merchantId: string, number: string): Promise<Invoice | null>;
  findByIdempotencyKey(key: string): Promise<Invoice | null>;
  update(invoice: Invoice, expectedVersion: number): Promise<void>;
  list(options: ListInvoicesOptions): Promise<readonly Invoice[]>;
  /** Listed invoices across every merchant, newest first, keyset-paginated. */
  listListed(options: ListListedInvoicesOptions): Promise<readonly Invoice[]>;

  /**
   * Allocates the merchant's next invoice number and stores the issued invoice
   * atomically.
   *
   * This is one method rather than an allocator plus an update because gapless
   * numbering demands it. Allocate first and write second, and a failed write
   * burns a number — which is a hole in the series, which is the thing the
   * requirement rules out. Both effects therefore belong to one transaction,
   * and only an adapter can open one.
   *
   * `toIssued` receives the allocated value and returns the invoice to store.
   * It is pure and may be called only once.
   *
   * A number is never reallocated, including when the invoice that consumed it
   * is later voided. Voiding withdraws a document; it does not free its place
   * in the series.
   */
  issue(draft: Invoice, toIssued: IssueWithSequence): Promise<Invoice>;
}
