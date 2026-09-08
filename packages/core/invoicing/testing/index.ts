/**
 * Reference in-memory fakes for the invoicing ports, shipped in a segregated
 * `/testing` subpath so domain `src/` stays pure.
 *
 * Mirrors the guarantees the Postgres implementation has to hold — unique
 * invoice numbers per merchant, unique idempotency keys, optimistic locking —
 * so a test exercises the same failure modes without a database.
 */

import { ConcurrencyError, ConflictError } from "@mayarin/shared";
import type {
  Invoice,
  InvoiceRepository,
  IssueWithSequence,
  ListInvoicesOptions,
  ListListedInvoicesOptions,
} from "../src/index.ts";

const DEFAULT_LIMIT = 100;

export class InMemoryInvoiceRepository implements InvoiceRepository {
  readonly #byId = new Map<string, Invoice>();
  readonly #nextNumber = new Map<string, number>();

  async insert(invoice: Invoice): Promise<void> {
    if (this.#byId.has(invoice.id)) {
      throw new ConflictError(`Invoice ${invoice.id} already exists`, { id: invoice.id });
    }
    if (invoice.idempotencyKey !== undefined) {
      const clash = await this.findByIdempotencyKey(invoice.idempotencyKey);
      if (clash !== null) {
        throw new ConflictError(`Idempotency key "${invoice.idempotencyKey}" is already in use`, {
          idempotencyKey: invoice.idempotencyKey,
        });
      }
    }
    this.#byId.set(invoice.id, invoice);
  }

  async findById(id: string): Promise<Invoice | null> {
    return this.#byId.get(id) ?? null;
  }

  async findByNumber(merchantId: string, number: string): Promise<Invoice | null> {
    for (const invoice of this.#byId.values()) {
      if (invoice.merchantId === merchantId && invoice.number === number) return invoice;
    }
    return null;
  }

  async findByIdempotencyKey(key: string): Promise<Invoice | null> {
    for (const invoice of this.#byId.values()) {
      if (invoice.idempotencyKey === key) return invoice;
    }
    return null;
  }

  async update(invoice: Invoice, expectedVersion: number): Promise<void> {
    const current = this.#byId.get(invoice.id);
    if (current === undefined) {
      throw new ConflictError(`Invoice ${invoice.id} does not exist`, { id: invoice.id });
    }
    if (current.version !== expectedVersion) {
      throw new ConcurrencyError(`Invoice ${invoice.id} was modified concurrently`, {
        id: invoice.id,
        expectedVersion,
        actualVersion: current.version,
      });
    }
    // A number is allocated once and never reallocated, so a clash here is a
    // bug in the allocator rather than a race a caller can lose.
    if (invoice.number !== undefined) {
      const holder = await this.findByNumber(invoice.merchantId, invoice.number);
      if (holder !== null && holder.id !== invoice.id) {
        throw new ConflictError(`Invoice number "${invoice.number}" is already in use`, {
          number: invoice.number,
          merchantId: invoice.merchantId,
        });
      }
    }
    this.#byId.set(invoice.id, invoice);
  }

  /**
   * Allocates and stores in one step, mirroring the Postgres transaction.
   *
   * Single-threaded JavaScript makes this trivially atomic here, which is
   * exactly why passing it is not evidence that the Postgres implementation is
   * correct. That one needs a row lock and its own test against a database.
   */
  async issue(draft: Invoice, toIssued: IssueWithSequence): Promise<Invoice> {
    const sequence = this.#nextNumber.get(draft.merchantId) ?? 1;
    const issued = toIssued(sequence);
    await this.update(issued, draft.version);
    this.#nextNumber.set(draft.merchantId, sequence + 1);
    return issued;
  }

  async list(options: ListInvoicesOptions): Promise<readonly Invoice[]> {
    return [...this.#byId.values()]
      .filter((invoice) => invoice.merchantId === options.merchantId)
      .filter((invoice) => options.state === undefined || invoice.state === options.state)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit ?? DEFAULT_LIMIT);
  }

  /** Same keyset semantics as the Postgres adapter: newest first, ties by id. */
  async listListed(options: ListListedInvoicesOptions): Promise<readonly Invoice[]> {
    return [...this.#byId.values()]
      .filter((invoice) => invoice.listed)
      .filter(
        (invoice) =>
          options.cursor === undefined ||
          invoice.createdAt.getTime() < options.cursor.createdAt.getTime() ||
          (invoice.createdAt.getTime() === options.cursor.createdAt.getTime() &&
            invoice.id < options.cursor.id),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, options.limit);
  }
}
