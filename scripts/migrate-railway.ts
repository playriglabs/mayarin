/**
 * Apply database migrations to the Railway Postgres service from a laptop.
 *
 *   bun run railway:migrate            show the target, change nothing
 *   bun run railway:migrate --yes      apply
 *
 * The `DATABASE_URL` on Railway names a `*.railway.internal` host that a laptop
 * cannot reach, so the URL is built from the service's TCP proxy instead. Values
 * are read in this process and handed to the migrator; none are printed.
 *
 * The proxy is public. Enable it for the run and remove it afterwards (SEC-05).
 */

import { spawn } from "bun";

const REQUIRED = [
  "PGUSER",
  "PGPASSWORD",
  "PGDATABASE",
  "RAILWAY_TCP_PROXY_DOMAIN",
  "RAILWAY_TCP_PROXY_PORT",
] as const;

async function postgresVariables(): Promise<Record<string, string>> {
  const child = spawn(["railway", "variable", "list", "--service", "Postgres", "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, error, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`Could not read the Postgres service: ${error.trim()}`);
  return JSON.parse(output) as Record<string, string>;
}

const apply = process.argv.includes("--yes");
const variables = await postgresVariables();

const missing = REQUIRED.filter((key) => (variables[key] ?? "") === "");
if (missing.length > 0) {
  throw new Error(
    `Missing ${missing.join(", ")}: the Postgres service has no TCP proxy. ` +
      "Enable one in Railway (Postgres, Settings, Networking) for the run.",
  );
}

const host = variables.RAILWAY_TCP_PROXY_DOMAIN;
const port = variables.RAILWAY_TCP_PROXY_PORT;
const user = encodeURIComponent(variables.PGUSER ?? "");
const password = encodeURIComponent(variables.PGPASSWORD ?? "");
const database = variables.PGDATABASE;
const url = `postgres://${user}:${password}@${host}:${port}/${database}`;

console.log(`target: ${host}:${port}/${database}`);
if (!apply) {
  console.log("dry run: nothing applied. Rerun with --yes to migrate.");
  process.exit(0);
}

const child = spawn(["bun", "run", "packages/db/src/migrate.ts"], {
  env: { ...process.env, DATABASE_URL: url },
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
