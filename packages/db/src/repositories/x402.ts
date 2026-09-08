/**
 * Postgres adapter for the x402 resource registry (#207).
 *
 * `accepts` is stored as JSON and parsed back with the same care the ledger
 * takes over an asset code: a row we cannot interpret must never become a
 * `PaymentRequired`. Every field is checked on the way out, because what is
 * being reconstructed is a payment instruction — a stored `payTo` that has been
 * corrupted to a string is an address a payer would sign a transfer to.
 */

import { isChainId } from "@mayarin/chain";
import { ValidationError } from "@mayarin/shared";
import type {
  AcceptedAsset,
  ListListedX402ResourcesOptions,
  ListX402ResourcesOptions,
  PaginatedX402ResourceRepository,
  X402Resource,
  X402ResourceListEntry,
} from "@mayarin/x402";
import { isAssetTransferMethod } from "@mayarin/x402";
import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { fromMoney, present, toAsset, toMoney } from "../mapping.ts";
import { x402Resources } from "../schema.ts";

type Row = typeof x402Resources.$inferSelect;

export class DrizzleX402ResourceRepository implements PaginatedX402ResourceRepository {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async findById(id: string): Promise<X402Resource | undefined> {
    const [row] = await this.#db
      .select()
      .from(x402Resources)
      .where(eq(x402Resources.id, id))
      .limit(1);
    return row === undefined ? undefined : toResource(row);
  }

  async listByMerchant(merchantId: string): Promise<readonly X402Resource[]> {
    const rows = await this.#db
      .select()
      .from(x402Resources)
      .where(eq(x402Resources.merchantId, merchantId));
    return rows.map(toResource);
  }

  async listPageByMerchant(
    options: ListX402ResourcesOptions,
  ): Promise<readonly X402ResourceListEntry[]> {
    const cursorFilter =
      options.cursor === undefined
        ? undefined
        : or(
            lt(x402Resources.createdAt, options.cursor.createdAt),
            and(
              eq(x402Resources.createdAt, options.cursor.createdAt),
              lt(x402Resources.id, options.cursor.id),
            ),
          );
    const rows = await this.#db
      .select()
      .from(x402Resources)
      .where(and(eq(x402Resources.merchantId, options.merchantId), cursorFilter))
      .orderBy(desc(x402Resources.createdAt), desc(x402Resources.id))
      .limit(options.limit);
    return rows.map((row) => ({ resource: toResource(row), createdAt: row.createdAt }));
  }

  /** The public cross-merchant index read (#273): listed only, keyset-paginated. */
  async listPageListed(
    options: ListListedX402ResourcesOptions,
  ): Promise<readonly X402ResourceListEntry[]> {
    const cursorFilter =
      options.cursor === undefined
        ? undefined
        : or(
            lt(x402Resources.createdAt, options.cursor.createdAt),
            and(
              eq(x402Resources.createdAt, options.cursor.createdAt),
              lt(x402Resources.id, options.cursor.id),
            ),
          );
    const rows = await this.#db
      .select()
      .from(x402Resources)
      .where(and(eq(x402Resources.listed, true), cursorFilter))
      .orderBy(desc(x402Resources.createdAt), desc(x402Resources.id))
      .limit(options.limit);
    return rows.map((row) => ({ resource: toResource(row), createdAt: row.createdAt }));
  }

  async remove(id: string): Promise<void> {
    await this.#db.delete(x402Resources).where(eq(x402Resources.id, id));
  }

  /**
   * Upsert by id.
   *
   * The unique index on `(merchant_id, url)` is not the conflict target: a
   * merchant moving a resource to a new URL keeps its id, and targeting the URL
   * would leave the old row behind as a second gate on an endpoint nobody
   * meant to keep charging for.
   */
  async save(resource: X402Resource): Promise<void> {
    const now = new Date();
    const price = fromMoney(resource.price);
    const mutable = {
      url: resource.url,
      description: resource.description ?? null,
      mimeType: resource.mimeType ?? null,
      priceAmount: price.amount,
      priceAsset: price.asset,
      accepts: [...resource.accepts],
      maxTimeoutSeconds: resource.maxTimeoutSeconds,
      listed: resource.listed,
      updatedAt: now,
    };

    await this.#db
      .insert(x402Resources)
      // `createdAt` is set here and never in `set`, so an update keeps the
      // moment the merchant first made this endpoint payable.
      .values({ id: resource.id, merchantId: resource.merchantId, createdAt: now, ...mutable })
      .onConflictDoUpdate({ target: x402Resources.id, set: mutable });
  }
}

function toResource(row: Row): X402Resource {
  return {
    id: row.id,
    merchantId: row.merchantId,
    url: row.url,
    ...present("description", row.description),
    ...present("mimeType", row.mimeType),
    price: toMoney(row.priceAmount, row.priceAsset),
    accepts: toAccepts(row.accepts, row.id),
    maxTimeoutSeconds: row.maxTimeoutSeconds,
    listed: row.listed,
  };
}

/**
 * Parse the stored `accepts` array.
 *
 * Every field is checked rather than cast. JSON columns have no schema, so the
 * only thing standing between a corrupted row and a `PaymentRequired` is this
 * function — and a `PaymentRequired` is what a payer signs a transfer against.
 * An unreadable row is a `ValidationError`, not a resource with one fewer way
 * to pay: silently dropping an option would make a resource cheaper to serve
 * and impossible to diagnose.
 */
export function toAccepts(value: unknown, resourceId: string): readonly AcceptedAsset[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`x402 resource ${resourceId} has a malformed accepts column`, {
      resourceId,
    });
  }
  return value.map((entry, index) => toAcceptedAsset(entry, resourceId, index));
}

export function toAcceptedAsset(value: unknown, resourceId: string, index: number): AcceptedAsset {
  const refuse = (why: string): never => {
    throw new ValidationError(`x402 resource ${resourceId} accepts[${index}] ${why}`, {
      resourceId,
      index,
    });
  };

  if (typeof value !== "object" || value === null) return refuse("is not an object");
  const entry = value as Record<string, unknown>;

  if (!isChainId(entry.chain)) return refuse(`names an unknown chain "${String(entry.chain)}"`);
  if (typeof entry.asset !== "string") return refuse("has no asset code");
  if (typeof entry.contract !== "string") return refuse("has no contract address");
  if (typeof entry.payTo !== "string") return refuse("has no payTo address");
  if (!isAssetTransferMethod(entry.transferMethod)) {
    return refuse(`names an unknown transferMethod "${String(entry.transferMethod)}"`);
  }

  const domain = entry.domain;
  if (typeof domain !== "object" || domain === null) return refuse("has no EIP-712 domain");
  const { name, version } = domain as Record<string, unknown>;
  if (typeof name !== "string" || typeof version !== "string") {
    return refuse("has an incomplete EIP-712 domain");
  }

  return {
    chain: entry.chain,
    // Checked, not cast. The asset is what the price is quoted into, so a code
    // this deployment does not know would produce a `PaymentRequired` naming an
    // amount in nothing.
    asset: toAsset(entry.asset),
    contract: entry.contract,
    payTo: entry.payTo,
    domain: { name, version },
    transferMethod: entry.transferMethod,
  };
}
