/**
 * Database client.
 *
 * One connection pool per process. Repositories accept an `Executor` — either
 * the pool or an open transaction — so a caller can compose several repository
 * calls into a single atomic unit of work.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { schema } from "./schema.ts";

export type Database = PostgresJsDatabase<typeof schema>;

/** An open transaction, as handed to the callback of `db.transaction`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything a repository can run statements against. */
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  readonly db: Database;
  /**
   * The raw postgres.js client.
   *
   * Exposed for `LISTEN`, which Drizzle has no surface for: a listener holds a
   * dedicated connection for the life of the process, which is the opposite of
   * what a query builder's pool is for. Nothing else should reach for this.
   */
  readonly sql: Sql;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  readonly url: string;
  readonly maxConnections?: number;
}

export function createDatabase(options: CreateDatabaseOptions): DatabaseHandle {
  const client = postgres(options.url, { max: options.maxConnections ?? 10 });
  return {
    db: drizzle(client, { schema }),
    sql: client,
    close: () => client.end(),
  };
}
