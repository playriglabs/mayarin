/**
 * Create or refresh the per-service database roles (SEC-05).
 *
 *   ADMIN_DATABASE_URL=postgres://owner:…@host:port/db \
 *   DB_ROLE_PASSWORD_CORE_API=… DB_ROLE_PASSWORD_DASHBOARD_API=… DB_ROLE_PASSWORD_CHAIN_WORKER=… \
 *     bun run scripts/db-roles.ts
 *
 * Run as the database owner, after `db:migrate` and again after any migration
 * that adds a table (default privileges cover tables created by the same owner,
 * so a re-run is only needed when tables were created by someone else). It
 * prints each service's connection string with the password elided; the
 * passwords are the ones you supplied. Passwords are at least 24 characters.
 * Use the output to set `DATABASE_URL` per service, then sync Railway with
 * `--keep-database-url` so the shared reference is not written back.
 *
 * It never connects as a service role and never prints a password.
 */

import postgres from "postgres";
import {
  roleStatements,
  SERVICE_ROLES,
  type ServiceName,
} from "../packages/db/src/service-roles.ts";

const adminUrl = process.env.ADMIN_DATABASE_URL;
if (adminUrl === undefined || adminUrl === "") {
  throw new Error("ADMIN_DATABASE_URL is required: the owner's connection string");
}

const passwordKey: Record<ServiceName, string> = {
  "core-api": "DB_ROLE_PASSWORD_CORE_API",
  "dashboard-api": "DB_ROLE_PASSWORD_DASHBOARD_API",
  "chain-worker": "DB_ROLE_PASSWORD_CHAIN_WORKER",
};

const parsed = new URL(adminUrl);
const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
const sql = postgres(adminUrl, { max: 1 });

try {
  for (const service of Object.keys(SERVICE_ROLES) as ServiceName[]) {
    const password = process.env[passwordKey[service]];
    if (password === undefined || password === "") {
      throw new Error(`${passwordKey[service]} is required`);
    }
    const role = SERVICE_ROLES[service];
    for (const statement of roleStatements(role, password, database)) {
      await sql.unsafe(statement);
    }
    const url = new URL(adminUrl);
    url.username = role;
    url.password = "<password>";
    console.log(`${service.padEnd(14)} ${url.toString().replace("%3Cpassword%3E", "<password>")}`);
  }
} finally {
  await sql.end();
}
