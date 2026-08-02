/**
 * Database client.
 *
 * One connection pool per process. Repositories accept an `Executor` — either
 * the pool or an open transaction — so a caller can compose several repository
 * calls into a single atomic unit of work.
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { schema } from "./schema.ts";

export type Database = PostgresJsDatabase<typeof schema>;

/** An open transaction, as handed to the callback of `db.transaction`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Anything a repository can run statements against. */
export type Executor = Database | Transaction;

export interface DatabaseHandle {
  readonly db: Database;
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
    close: () => client.end(),
  };
}
