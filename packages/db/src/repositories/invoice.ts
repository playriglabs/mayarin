/**
 * Postgres adapter for invoicing (#112).
 *
 * The interesting method is `issue`. Everything else is an ordinary mapped
 * write with an optimistic-locking guard.
 */

import type {
  Invoice,
  InvoiceRepository,
  InvoiceState,
  IssueWithSequence,
  ListInvoicesOptions,
  ListListedInvoicesOptions,
} from "@mayarin/invoicing";
import { ConcurrencyError, ConflictError } from "@mayarin/shared";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, runInTransaction, toAsset, toMoney } from "../mapping.ts";
import { invoiceCounters, invoices } from "../schema.ts";

type InvoiceRow = typeof invoices.$inferSelect;

const DEFAULT_LIMIT = 100;

export class DrizzleInvoiceRepository implements InvoiceRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(invoice: Invoice): Promise<void> {
    await this.#db.insert(invoices).values(toRow(invoice));
  }

  async findById(id: string): Promise<Invoice | null> {
    const [row] = await this.#db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    return row === undefined ? null : toInvoice(row);
  }

  async findByNumber(merchantId: string, number: string): Promise<Invoice | null> {
    const [row] = await this.#db
      .select()
      .from(invoices)
      .where(and(eq(invoices.merchantId, merchantId), eq(invoices.number, number)))
      .limit(1);
    return row === undefined ? null : toInvoice(row);
  }

  async findByIdempotencyKey(key: string): Promise<Invoice | null> {
    const [row] = await this.#db
      .select()
      .from(invoices)
      .where(eq(invoices.idempotencyKey, key))
      .limit(1);
    return row === undefined ? null : toInvoice(row);
  }

  async update(invoice: Invoice, expectedVersion: number): Promise<void> {
    await update(this.#db, invoice, expectedVersion);
  }

  async list(options: ListInvoicesOptions): Promise<readonly Invoice[]> {
    const filters = [eq(invoices.merchantId, options.merchantId)];
    if (options.state !== undefined) filters.push(eq(invoices.state, options.state));

    const rows = await this.#db
      .select()
      .from(invoices)
      .where(and(...filters))
      .orderBy(desc(invoices.createdAt))
      .limit(options.limit ?? DEFAULT_LIMIT);
    return rows.map(toInvoice);
  }

  /** The public x402 payable index read (#273): listed only, keyset-paginated. */
  async listListed(options: ListListedInvoicesOptions): Promise<readonly Invoice[]> {
    const cursorFilter =
      options.cursor === undefined
        ? undefined
        : or(
            lt(invoices.createdAt, options.cursor.createdAt),
            and(
              eq(invoices.createdAt, options.cursor.createdAt),
              lt(invoices.id, options.cursor.id),
            ),
          );
    const rows = await this.#db
      .select()
      .from(invoices)
      .where(and(eq(invoices.listed, true), cursorFilter))
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(options.limit);
    return rows.map(toInvoice);
  }

  /**
   * Allocates the merchant's next number and stores the issued invoice in one
   * transaction.
   *
   * Gaplessness is exactly this atomicity. The upsert below both creates a
   * merchant's counter on first use and increments an existing one, and it
   * takes a row lock that is held until this transaction ends — so a second
   * issuer for the same merchant waits here rather than reading a stale value.
   * If the invoice write then fails, the increment rolls back with it and the
   * number is handed to the next caller instead of being burned.
   *
   * `ON CONFLICT DO UPDATE` is what makes the first call and every later call
   * one statement. A read-then-write would race, and `nextval` on a sequence
   * would leave gaps by design.
   */
  async issue(draft: Invoice, toIssued: IssueWithSequence): Promise<Invoice> {
    return runInTransaction(this.#db, async (tx) => {
      const rows = await tx.execute<{ allocated: number }>(sql`
        insert into ${invoiceCounters} (merchant_id, next_number)
        values (${draft.merchantId}, 2)
        on conflict (merchant_id)
          do update set next_number = ${invoiceCounters}.next_number + 1
        returning next_number - 1 as allocated
      `);

      // `execute` returns driver-shaped results; a missing row here would mean
      // the upsert returned nothing, which cannot happen and must not be
      // papered over with a default sequence of 1.
      const allocated = [...rows][0]?.allocated;
      if (allocated === undefined) {
        throw new ConflictError(`Could not allocate an invoice number for ${draft.merchantId}`, {
          merchantId: draft.merchantId,
        });
      }

      const issued = toIssued(Number(allocated));
      await update(tx, issued, draft.version);
      return issued;
    });
  }
}

/** Shared by `update` and `issue`, so both enforce the same locking guard. */
async function update(db: Executor, invoice: Invoice, expectedVersion: number): Promise<void> {
  const updated = await db
    .update(invoices)
    .set(toRow(invoice))
    .where(and(eq(invoices.id, invoice.id), eq(invoices.version, expectedVersion)))
    .returning({ id: invoices.id });

  if (updated.length === 0) {
    throw new ConcurrencyError(`Invoice ${invoice.id} was modified concurrently`, {
      id: invoice.id,
      expectedVersion,
    });
  }
}

function toRow(invoice: Invoice): typeof invoices.$inferInsert {
  return {
    id: invoice.id,
    merchantId: invoice.merchantId,
    merchantName: invoice.merchant.name,
    merchantCity: invoice.merchant.city,
    merchantCountryCode: invoice.merchant.countryCode,
    merchantCategoryCode: invoice.merchant.categoryCode ?? null,
    number: invoice.number ?? null,
    sequence: invoice.sequence ?? null,
    state: invoice.state,
    buyerName: invoice.buyer.name,
    buyerEmail: invoice.buyer.email ?? null,
    buyerTaxId: invoice.buyer.taxId ?? null,
    buyerAddress: invoice.buyer.address ?? null,
    currency: invoice.currency,
    lines: invoice.lines.map((line) => ({
      ...(line.productId === undefined ? {} : { productId: line.productId }),
      name: line.name,
      unitPrice: line.unitPrice.amount.toString(),
      quantity: line.quantity,
    })),
    total: invoice.total.amount.toString(),
    totalAsset: invoice.total.asset,
    notes: invoice.notes ?? null,
    metadata: { ...invoice.metadata },
    issuedAt: invoice.issuedAt ?? null,
    dueAt: invoice.dueAt ?? null,
    voidedAt: invoice.voidedAt ?? null,
    listed: invoice.listed,
    idempotencyKey: invoice.idempotencyKey ?? null,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    version: invoice.version,
  };
}

function toInvoice(row: InvoiceRow): Invoice {
  const currency = toAsset(row.currency);

  return {
    id: row.id,
    merchantId: row.merchantId,
    merchant: {
      id: row.merchantId,
      name: row.merchantName,
      city: row.merchantCity,
      countryCode: row.merchantCountryCode,
      ...present("categoryCode", row.merchantCategoryCode),
    },
    ...present("number", row.number),
    ...present("sequence", row.sequence),
    state: row.state as InvoiceState,
    buyer: {
      name: row.buyerName,
      ...present("email", row.buyerEmail),
      ...present("taxId", row.buyerTaxId),
      ...present("address", row.buyerAddress),
    },
    currency,
    lines: row.lines.map((line) => ({
      ...present("productId", line.productId),
      name: line.name,
      unitPrice: toMoney(line.unitPrice, currency),
      quantity: line.quantity,
    })),
    total: toMoney(row.total, row.totalAsset),
    ...present("notes", row.notes),
    metadata: row.metadata,
    ...present("issuedAt", row.issuedAt),
    ...present("dueAt", row.dueAt),
    ...present("voidedAt", row.voidedAt),
    listed: row.listed,
    ...present("idempotencyKey", row.idempotencyKey),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}
