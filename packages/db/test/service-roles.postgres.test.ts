/**
 * The per-service database roles (SEC-05) against a real Postgres.
 *
 * Privileges only exist in a database, so this is where "a service credential
 * cannot drop a table" is actually proved. Keys on `TEST_DATABASE_URL`, like the
 * other Postgres suites. The role is cluster-wide, so it carries a test-only name
 * and is dropped afterwards; a real service role is never touched.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";
import { APPEND_ONLY_TABLES, roleStatements } from "../src/service-roles.ts";
import { guardedTestDatabaseUrl } from "./database-guard.ts";

const URL = guardedTestDatabaseUrl(process.env);
const ROLE = "mayarin_test_service_role";
const PASSWORD = "test-password-with-24-or-more-characters";

/** A postgres.js query is a lazy thenable, which `.rejects` does not run; this does. */
async function refused(statement: string, sql: postgres.Sql): Promise<string> {
  try {
    await sql.unsafe(statement);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`Expected to be refused, but it ran: ${statement}`);
}

describe.skipIf(URL === undefined)("service roles", () => {
  const owner = postgres(URL as string, { max: 1 });
  let service: postgres.Sql;

  beforeAll(async () => {
    const database = decodeURIComponent(new globalThis.URL(URL as string).pathname.slice(1));
    // Twice: the statements are meant to be re-run.
    for (let pass = 0; pass < 2; pass += 1) {
      for (const statement of roleStatements(ROLE, PASSWORD, database)) {
        await owner.unsafe(statement);
      }
    }
    const asService = new globalThis.URL(URL as string);
    asService.username = ROLE;
    asService.password = PASSWORD;
    service = postgres(asService.toString(), { max: 1 });
  });

  afterAll(async () => {
    await service.end();
    await owner.unsafe(`DROP OWNED BY "${ROLE}"`);
    await owner.unsafe(`DROP ROLE "${ROLE}"`);
    await owner.end();
  });

  test("reads and writes rows", async () => {
    await service`insert into watcher_cursors (chain, asset, last_block, updated_at)
      values ('base-sepolia', 'role-test', 1, now())`;
    await service`update watcher_cursors set last_block = 2 where asset = 'role-test'`;
    const rows = await service`select last_block from watcher_cursors where asset = 'role-test'`;
    expect(String(rows[0]?.last_block)).toBe("2");
    await service`delete from watcher_cursors where asset = 'role-test'`;
  });

  test("cannot change the schema, empty a table or reach the migration journal", async () => {
    await refused("create table role_test_scratch (id int)", service);
    await refused("drop table watcher_cursors", service);
    await refused("alter table watcher_cursors add column x int", service);
    await refused("truncate watcher_cursors", service);
    await refused("select * from drizzle.__drizzle_migrations", service);
  });

  test("cannot create roles or databases", async () => {
    await refused("create role mayarin_test_other", service);
    await refused("create database mayarin_test_other", service);
  });

  test("cannot update or delete the append-only tables, by privilege as well as by trigger", async () => {
    for (const table of APPEND_ONLY_TABLES) {
      expect(await refused(`update ${table} set id = id`, service)).toMatch(/permission denied/);
      expect(await refused(`delete from ${table}`, service)).toMatch(/permission denied/);
    }
  });

  test("a table created after the grant is usable without another run", async () => {
    await owner.unsafe("create table role_test_later (id int)");
    try {
      await service.unsafe("insert into role_test_later values (1)");
    } finally {
      await owner.unsafe("drop table role_test_later");
    }
  });
});
