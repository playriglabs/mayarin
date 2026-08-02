/**
 * Migration runner.
 *
 * `bun run db:migrate` from the repo root. Applies everything in `migrations/`
 * and exits — deploys run it before starting the API.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDatabase } from "./client.ts";

const url = process.env.DATABASE_URL;
if (url === undefined) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const handle = createDatabase({ url, maxConnections: 1 });

try {
  await migrate(handle.db, { migrationsFolder });
  console.log(`Migrations applied from ${migrationsFolder}`);
} finally {
  await handle.close();
}
