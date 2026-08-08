/**
 * `bun run prune-orphan-merchants` — removes merchant rows no account owns.
 *
 * Cleanup for issue #100, where `createMerchantAccount` wrote the merchant and
 * its first user without a transaction: a failed second write left a tenant
 * nothing can sign in to and nothing deletes. The fix stops new ones appearing;
 * this removes the ones already there.
 *
 * ```
 * bun run prune-orphan-merchants              # report, change nothing
 * bun run prune-orphan-merchants -- --delete  # actually delete
 * ```
 *
 * A script rather than a migration, deliberately. A migration deleting merchant
 * rows would run unattended on every environment it reaches, including one where
 * such a row is intentional — a tenant provisioned ahead of its first account,
 * say. Deleting merchant data should be something an operator does on purpose,
 * having read the list first, which is why the default is a report and the
 * deletion needs a flag.
 *
 * Rows are printed before they are deleted either way, so the report is the
 * record of what was removed.
 */

import { createDatabase } from "@mayarin/db";
import { merchants, users } from "@mayarin/db/schema";
import { eq, inArray, notExists } from "drizzle-orm";

const remove = process.argv.includes("--delete");

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === "") {
  console.error(
    "DATABASE_URL is not set.\n" +
      "This script runs from the repo root, which loads .env — check it is set there.",
  );
  process.exit(1);
}

const handle = createDatabase({ url: databaseUrl });

try {
  const orphans = await handle.db
    .select({
      id: merchants.id,
      name: merchants.name,
      createdAt: merchants.createdAt,
    })
    .from(merchants)
    .where(
      notExists(
        handle.db.select({ one: users.id }).from(users).where(eq(users.merchantId, merchants.id)),
      ),
    );

  if (orphans.length === 0) {
    console.log("No orphan merchants — every merchant row has at least one account.");
    process.exit(0);
  }

  console.log(`${orphans.length} merchant(s) with no account:\n`);
  for (const orphan of orphans) {
    console.log(`  ${orphan.id}  ${orphan.name}  ${orphan.createdAt.toISOString()}`);
  }

  if (!remove) {
    console.log("\nNothing was changed. Re-run with --delete to remove them.");
    process.exit(0);
  }

  // Deleted by the ids just listed rather than by re-running the predicate, so
  // what is removed is exactly what was printed. A merchant that gained an
  // account between the two statements would otherwise be deleted without ever
  // appearing in the report.
  const deleted = await handle.db
    .delete(merchants)
    .where(
      inArray(
        merchants.id,
        orphans.map((orphan) => orphan.id),
      ),
    )
    .returning({ id: merchants.id });

  console.log(`\nDeleted ${deleted.length} merchant(s).`);
} finally {
  await handle.close();
}
