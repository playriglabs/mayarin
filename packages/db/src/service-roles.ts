/**
 * Least-privilege database roles for the running services (SEC-05).
 *
 * The services used to connect with the database owner's credential, so a leak
 * from any one of them could drop tables, rewrite history or create roles. A
 * service role can read and write rows and nothing else: no DDL, no TRUNCATE, no
 * ownership, no role or database creation, no access to the migration journal.
 * Migrations keep running as the owner, from outside the services.
 *
 * The append-only tables (migration 0056) also lose UPDATE and DELETE here, so the
 * restriction holds even if a trigger is ever dropped.
 *
 * Table-level scoping per service (the worker needs no `users`, the dashboard no
 * `chain_deposits`) is a further step; it needs each service's table list
 * verified first, and a wrong list is an outage, not a finding.
 */

export const SERVICE_ROLES = {
  "core-api": "mayarin_core_api",
  "dashboard-api": "mayarin_dashboard_api",
  "chain-worker": "mayarin_chain_worker",
} as const;

export type ServiceName = keyof typeof SERVICE_ROLES;

/** Tables the application only ever appends to. */
export const APPEND_ONLY_TABLES = [
  "clearing_events",
  "ledger_entries",
  "ledger_transactions",
  "wallet_withdrawals",
  "admin_audit_events",
  "merchant_setting_changes",
  "escrow_dispute_messages",
] as const;

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function identifier(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`Not a safe SQL identifier: ${name}`);
  return `"${name}"`;
}

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The statements that bring one role to its intended state; safe to run again. */
export function roleStatements(role: string, password: string, database: string): string[] {
  if (password.length < 24)
    throw new Error(`The password for ${role} must be at least 24 characters`);
  const r = identifier(role);
  const db = identifier(database);
  return [
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${literal(role)}) THEN CREATE ROLE ${r} LOGIN; END IF; END $$`,
    `ALTER ROLE ${r} WITH LOGIN PASSWORD ${literal(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 25`,
    `REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${db} TO ${r}`,
    `GRANT USAGE ON SCHEMA public TO ${r}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${r}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${r}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${r}`,
    `REVOKE UPDATE, DELETE ON ${APPEND_ONLY_TABLES.map(identifier).join(", ")} FROM ${r}`,
  ];
}
