/**
 * `bun run db:wipe` — empties the local database completely.
 *
 * Drops every non-system schema, then recreates an empty `public`. That removes
 * the tables, the enums, the sequences and the `drizzle` migration bookkeeping,
 * so the database is in the same state as a freshly created one and
 * `bun run db:migrate` rebuilds it from zero.
 *
 * ```
 * bun run db:wipe     # drop everything
 * bun run db:reset    # drop everything, then migrate
 * ```
 *
 * Truncation is deliberately not what this does. Truncating leaves the schema
 * and the applied-migration list behind, which hides a stale schema instead of
 * removing it. This is the "start again" button.
 *
 * The script refuses to run against a host that is not local. Losing a local
 * volume costs a migrate; losing a remote one costs the data.
 */

import postgres from "postgres";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal"]);

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl === "") {
  console.error(
    "DATABASE_URL is not set.\n" +
      "This script runs from the repo root, which loads .env — check it is set there.",
  );
  process.exit(1);
}

const host = new URL(databaseUrl).hostname;
if (!LOCAL_HOSTS.has(host)) {
  console.error(
    `Refusing to wipe ${host}: this script only runs against a local database.\n` +
      "Change DATABASE_URL to a local one, or drop the remote database with its own tooling.",
  );
  process.exit(1);
}

// Every cascade prints a NOTICE naming the object it took with it. That is one
// line per table on a wipe, which buries the result.
const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  const dropped = await client<Array<{ nspname: string }>>`
    select nspname from pg_namespace
    where nspname not like 'pg\\_%' and nspname <> 'information_schema'
    order by nspname
  `;

  await client.unsafe(`
    do $$
    declare target text;
    begin
      for target in
        select nspname from pg_namespace
        where nspname not like 'pg\\_%' and nspname <> 'information_schema'
      loop
        execute format('drop schema %I cascade', target);
      end loop;
    end $$;
    create schema public;
  `);

  console.log(`Wiped ${host}: dropped ${dropped.map((row) => row.nspname).join(", ")}`);
  console.log("Run `bun run db:migrate` to rebuild the schema.");
} finally {
  await client.end();
}
