/**
 * Postgres adapter for the runtime market-config store (#95).
 *
 * Values are opaque JSON here on purpose. Each key already has a zod schema
 * that parses it out of an environment string, and the composition root reuses
 * that schema to parse it back out of this table — so there is one definition
 * of what each value may be, rather than a second one in the storage layer that
 * can quietly disagree with the first.
 */

import type { MarketConfigEntry, MarketConfigStore } from "@mayarin/shared";
import { eq } from "drizzle-orm";
import type { Executor } from "../client.ts";
import { present } from "../mapping.ts";
import { marketConfig } from "../schema.ts";

type Row = typeof marketConfig.$inferSelect;

export class DrizzleMarketConfigRepository implements MarketConfigStore {
  readonly #db: Executor;

  constructor(db: Executor) {
    this.#db = db;
  }

  async all(): Promise<readonly MarketConfigEntry[]> {
    const rows = await this.#db.select().from(marketConfig);
    return rows.map(toEntry);
  }

  async get(key: string): Promise<MarketConfigEntry | undefined> {
    const [row] = await this.#db
      .select()
      .from(marketConfig)
      .where(eq(marketConfig.key, key))
      .limit(1);
    return row === undefined ? undefined : toEntry(row);
  }

  async put(entry: {
    key: string;
    value: unknown;
    updatedAt: Date;
    updatedBy?: string;
  }): Promise<void> {
    await this.#db
      .insert(marketConfig)
      .values({
        key: entry.key,
        value: entry.value,
        updatedAt: entry.updatedAt,
        updatedBy: entry.updatedBy ?? null,
      })
      .onConflictDoUpdate({
        target: marketConfig.key,
        set: {
          value: entry.value,
          updatedAt: entry.updatedAt,
          updatedBy: entry.updatedBy ?? null,
        },
      });
  }

  /**
   * Seeds a key exactly once.
   *
   * `onConflictDoNothing` rather than a read-then-write: two processes booting
   * together would both see the key absent, and the second would overwrite a
   * value an operator may already have changed. Returns whether this call is
   * the one that wrote it.
   */
  async putIfAbsent(entry: { key: string; value: unknown; updatedAt: Date }): Promise<boolean> {
    const inserted = await this.#db
      .insert(marketConfig)
      .values({
        key: entry.key,
        value: entry.value,
        updatedAt: entry.updatedAt,
        updatedBy: null,
      })
      .onConflictDoNothing({ target: marketConfig.key })
      .returning({ key: marketConfig.key });

    return inserted.length > 0;
  }
}

function toEntry(row: Row): MarketConfigEntry {
  return {
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt,
    ...present("updatedBy", row.updatedBy),
  };
}
