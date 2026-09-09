/**
 * Postgres adapters for the commerce ports (#10).
 *
 * A product's prices live in their own table, so writing a product is two
 * statements that must not half-apply — every write here runs in a transaction
 * for that reason, not out of habit.
 */

import type {
  Customer,
  CustomerRepository,
  ListCustomersOptions,
  ListListedLinksOptions,
  ListPaymentLinksOptions,
  ListProductsOptions,
  PaymentLink,
  PaymentLinkKind,
  PaymentLinkRepository,
  Product,
  ProductRepository,
} from "@mayarin/catalog";
import { isChainId } from "@mayarin/chain";
import { ConcurrencyError, type Money, ValidationError } from "@mayarin/shared";
import { and, asc, desc, eq, gte, ilike, inArray, lt, or } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present, runInTransaction, toAsset, toMoney } from "../mapping.ts";
import { customers, paymentLinks, productPrices, products } from "../schema.ts";

type ProductRow = typeof products.$inferSelect;
type LinkRow = typeof paymentLinks.$inferSelect;
type CustomerRow = typeof customers.$inferSelect;

export class DrizzleProductRepository implements ProductRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(product: Product): Promise<void> {
    await runInTransaction(this.#db, async (tx) => {
      await tx.insert(products).values(toProductRow(product));
      await tx.insert(productPrices).values(toPriceRows(product));
    });
  }

  async findById(id: string): Promise<Product | null> {
    const [product] = await this.findManyById([id]);
    return product ?? null;
  }

  async findManyById(ids: readonly string[]): Promise<readonly Product[]> {
    if (ids.length === 0) return [];
    const rows = await this.#db
      .select()
      .from(products)
      .where(inArray(products.id, [...ids]));
    return this.#withPrices(rows);
  }

  async findBySku(merchantId: string, sku: string): Promise<Product | null> {
    const rows = await this.#db
      .select()
      .from(products)
      .where(and(eq(products.merchantId, merchantId), eq(products.sku, sku)))
      .limit(1);
    const [product] = await this.#withPrices(rows);
    return product ?? null;
  }

  /**
   * Optimistic update: the row only moves if it is still at the version the
   * caller read. Prices are replaced wholesale rather than diffed — a price set
   * is small, and a delete-then-insert inside the same transaction cannot leave
   * a product priced in a currency the caller removed.
   */
  async update(product: Product, expectedVersion: number): Promise<void> {
    await runInTransaction(this.#db, async (tx) => {
      const updated = await tx
        .update(products)
        .set(toProductRow(product))
        .where(and(eq(products.id, product.id), eq(products.version, expectedVersion)))
        .returning({ id: products.id });

      if (updated.length === 0) {
        throw new ConcurrencyError(`Product ${product.id} was modified concurrently`, {
          id: product.id,
          expectedVersion,
        });
      }

      await tx.delete(productPrices).where(eq(productPrices.productId, product.id));
      await tx.insert(productPrices).values(toPriceRows(product));
    });
  }

  async list(options: ListProductsOptions): Promise<readonly Product[]> {
    const cursorFilter =
      options.cursor === undefined
        ? undefined
        : or(
            lt(products.createdAt, options.cursor.createdAt),
            and(
              eq(products.createdAt, options.cursor.createdAt),
              lt(products.id, options.cursor.id),
            ),
          );
    const rows = await this.#db
      .select()
      .from(products)
      .where(
        and(
          eq(products.merchantId, options.merchantId),
          options.active === undefined ? undefined : eq(products.active, options.active),
          cursorFilter,
        ),
      )
      .orderBy(desc(products.createdAt), desc(products.id))
      .limit(options.limit ?? 100);
    return this.#withPrices(rows);
  }

  /** One extra query for the whole page, rather than one per product. */
  async #withPrices(rows: readonly ProductRow[]): Promise<readonly Product[]> {
    if (rows.length === 0) return [];

    const priceRows = await this.#db
      .select()
      .from(productPrices)
      .where(
        inArray(
          productPrices.productId,
          rows.map((row) => row.id),
        ),
      );

    const byProduct = new Map<string, Money[]>();
    for (const price of priceRows) {
      const list = byProduct.get(price.productId) ?? [];
      list.push(toMoney(price.amount, price.asset));
      byProduct.set(price.productId, list);
    }

    return rows.map((row) => toProduct(row, byProduct.get(row.id) ?? []));
  }
}

export class DrizzlePaymentLinkRepository implements PaymentLinkRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(link: PaymentLink): Promise<void> {
    await this.#db.insert(paymentLinks).values(toLinkRow(link));
  }

  async findById(id: string): Promise<PaymentLink | null> {
    const [row] = await this.#db
      .select()
      .from(paymentLinks)
      .where(eq(paymentLinks.id, id))
      .limit(1);
    return row === undefined ? null : toLink(row);
  }

  async findByIdempotencyKey(key: string): Promise<PaymentLink | null> {
    const [row] = await this.#db
      .select()
      .from(paymentLinks)
      .where(eq(paymentLinks.idempotencyKey, key))
      .limit(1);
    return row === undefined ? null : toLink(row);
  }

  async update(link: PaymentLink, expectedVersion: number): Promise<void> {
    const updated = await this.#db
      .update(paymentLinks)
      .set(toLinkRow(link))
      .where(and(eq(paymentLinks.id, link.id), eq(paymentLinks.version, expectedVersion)))
      .returning({ id: paymentLinks.id });

    if (updated.length === 0) {
      throw new ConcurrencyError(`Payment link ${link.id} was modified concurrently`, {
        id: link.id,
        expectedVersion,
      });
    }
  }

  async list(options: ListPaymentLinksOptions): Promise<readonly PaymentLink[]> {
    const cursorFilter =
      options.cursor === undefined
        ? undefined
        : or(
            lt(paymentLinks.createdAt, options.cursor.createdAt),
            and(
              eq(paymentLinks.createdAt, options.cursor.createdAt),
              lt(paymentLinks.id, options.cursor.id),
            ),
          );
    const rows = await this.#db
      .select()
      .from(paymentLinks)
      .where(and(eq(paymentLinks.merchantId, options.merchantId), cursorFilter))
      .orderBy(desc(paymentLinks.createdAt), desc(paymentLinks.id))
      .limit(options.limit ?? 100);
    return rows.map(toLink);
  }

  /** The public x402 payable index read (#273): listed only, keyset-paginated. */
  async listListed(options: ListListedLinksOptions): Promise<readonly PaymentLink[]> {
    const cursorFilter =
      options.cursor === undefined
        ? undefined
        : or(
            lt(paymentLinks.createdAt, options.cursor.createdAt),
            and(
              eq(paymentLinks.createdAt, options.cursor.createdAt),
              lt(paymentLinks.id, options.cursor.id),
            ),
          );
    const rows = await this.#db
      .select()
      .from(paymentLinks)
      .where(and(eq(paymentLinks.listed, true), cursorFilter))
      .orderBy(desc(paymentLinks.createdAt), desc(paymentLinks.id))
      .limit(options.limit);
    return rows.map(toLink);
  }
}

function toProductRow(product: Product): typeof products.$inferInsert {
  return {
    id: product.id,
    merchantId: product.merchantId,
    sku: product.sku,
    name: product.name,
    description: product.description ?? null,
    active: product.active,
    metadata: { ...product.metadata },
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    version: product.version,
  };
}

function toPriceRows(product: Product): (typeof productPrices.$inferInsert)[] {
  return product.prices.map((price) => ({
    productId: product.id,
    asset: price.asset,
    amount: price.amount.toString(),
  }));
}

function toProduct(row: ProductRow, prices: readonly Money[]): Product {
  return {
    id: row.id,
    merchantId: row.merchantId,
    sku: row.sku,
    name: row.name,
    ...present("description", row.description),
    // Sorted so a product reads the same on every fetch regardless of row order.
    prices: [...prices].sort((a, b) => a.asset.localeCompare(b.asset)),
    active: row.active,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function toLinkRow(link: PaymentLink): typeof paymentLinks.$inferInsert {
  return {
    id: link.id,
    kind: link.kind,
    merchantId: link.merchant.id,
    merchantName: link.merchant.name,
    merchantCity: link.merchant.city,
    merchantCountryCode: link.merchant.countryCode,
    merchantCategoryCode: link.merchant.categoryCode ?? null,
    amount: link.amount?.amount.toString() ?? null,
    amountAsset: link.amount?.asset ?? null,
    currency: link.currency ?? null,
    lines: link.lines === undefined ? null : link.lines.map((line) => ({ ...line })),
    title: link.title ?? null,
    merchantReference: link.merchantReference ?? null,
    metadata: { ...link.metadata },
    rails: link.rails === undefined ? null : link.rails.map((rail) => ({ ...rail })),
    expiresAt: link.expiresAt ?? null,
    disabledAt: link.disabledAt ?? null,
    listed: link.listed,
    idempotencyKey: link.idempotencyKey ?? null,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    version: link.version,
  };
}

function toLink(row: LinkRow): PaymentLink {
  return {
    id: row.id,
    kind: row.kind as PaymentLinkKind,
    merchant: {
      id: row.merchantId,
      name: row.merchantName,
      city: row.merchantCity,
      countryCode: row.merchantCountryCode,
      ...present("categoryCode", row.merchantCategoryCode),
    },
    ...present("amount", linkAmount(row)),
    ...present("currency", row.currency === null ? null : toAsset(row.currency)),
    ...present("lines", row.lines),
    ...present("title", row.title),
    ...present("merchantReference", row.merchantReference),
    metadata: row.metadata,
    ...present("rails", row.rails === null ? undefined : toLinkRails(row.rails)),
    ...present("expiresAt", row.expiresAt),
    ...present("disabledAt", row.disabledAt),
    listed: row.listed,
    ...present("idempotencyKey", row.idempotencyKey),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

/**
 * A fixed link's amount, or nothing.
 *
 * Both columns are written together or not at all, so an amount without its
 * asset is a corrupt row rather than a shape to guess a currency for — hence
 * the hard error from `toMoney` rather than a default.
 */
function linkAmount(row: LinkRow): Money | undefined {
  if (row.amount === null || row.amountAsset === null) return undefined;
  return toMoney(row.amount, row.amountAsset);
}

/**
 * A link's rail restriction, hard-validated like every other stored code.
 *
 * The jsonb column is typed only as strings, so a rail that is not a known
 * chain or asset is a corrupt row — and a hard error is the honest answer,
 * because guessing (dropping the entry) would silently narrow what the link
 * offers, which is a merchant-visible change made by nobody's decision.
 */
function toLinkRails(rails: NonNullable<LinkRow["rails"]>): PaymentLink["rails"] {
  return rails.map((rail) => {
    if (!isChainId(rail.chain)) {
      throw new ValidationError(`Stored link rail chain "${rail.chain}" is not a chain`, {
        chain: rail.chain,
      });
    }
    return { chain: rail.chain, asset: toAsset(rail.asset) };
  });
}

export class DrizzleCustomerRepository implements CustomerRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async insert(customer: Customer): Promise<void> {
    await this.#db.insert(customers).values(toCustomerRow(customer));
  }

  async findById(id: string): Promise<Customer | null> {
    const [row] = await this.#db.select().from(customers).where(eq(customers.id, id)).limit(1);
    return row === undefined ? null : toCustomer(row);
  }

  async listByMerchant(options: ListCustomersOptions): Promise<readonly Customer[]> {
    const filters = [
      eq(customers.merchantId, options.merchantId),
      options.q === undefined
        ? undefined
        : or(
            ilike(customers.id, `%${options.q}%`),
            ilike(customers.name, `%${options.q}%`),
            ilike(customers.email, `%${options.q}%`),
          ),
      options.from === undefined ? undefined : gte(customers.createdAt, options.from),
      options.to === undefined ? undefined : lt(customers.createdAt, options.to),
    ].filter((filter) => filter !== undefined);
    const rows = await this.#db
      .select()
      .from(customers)
      .where(and(...filters))
      .orderBy(options.sort === "created" ? asc(customers.createdAt) : desc(customers.createdAt))
      .limit(options.limit ?? 100);
    return rows.map(toCustomer);
  }

  async update(customer: Customer, expectedVersion: number): Promise<void> {
    const updated = await this.#db
      .update(customers)
      .set(toCustomerRow(customer))
      .where(and(eq(customers.id, customer.id), eq(customers.version, expectedVersion)))
      .returning({ id: customers.id });

    if (updated.length === 0) {
      throw new ConcurrencyError(`Customer ${customer.id} was modified concurrently`, {
        id: customer.id,
        expectedVersion,
      });
    }
  }

  async delete(id: string): Promise<void> {
    await this.#db.delete(customers).where(eq(customers.id, id));
  }
}

function toCustomerRow(customer: Customer): typeof customers.$inferInsert {
  return {
    id: customer.id,
    merchantId: customer.merchantId,
    name: customer.name,
    email: customer.email ?? null,
    notes: customer.notes ?? null,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    version: customer.version,
  };
}

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    merchantId: row.merchantId,
    name: row.name,
    ...present("email", row.email),
    ...present("notes", row.notes),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}
