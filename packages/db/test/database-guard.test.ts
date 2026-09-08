import { describe, expect, test } from "bun:test";
import { guardedTestDatabaseUrl } from "./database-guard.ts";

const TEST_URL = "postgres://mayarin:mayarin@localhost:5433/mayarin_test";

describe("guardedTestDatabaseUrl", () => {
  test("keeps Postgres suites opt-in", () => {
    expect(guardedTestDatabaseUrl({})).toBeUndefined();
  });

  test("accepts a dedicated database whose name ends in _test", () => {
    expect(
      guardedTestDatabaseUrl({
        DATABASE_URL: "postgres://mayarin:mayarin@localhost:5433/mayarin",
        TEST_DATABASE_URL: TEST_URL,
      }),
    ).toBe(TEST_URL);
  });

  test("refuses the development database even with different credentials", () => {
    expect(() =>
      guardedTestDatabaseUrl({
        DATABASE_URL: "postgres://dev:secret@localhost:5433/mayarin_test?sslmode=disable",
        TEST_DATABASE_URL: "postgresql://test:other@127.0.0.1:5433/mayarin_test",
      }),
    ).toThrow("same database as DATABASE_URL");
  });

  test("refuses a target not unmistakably named as a test database", () => {
    expect(() =>
      guardedTestDatabaseUrl({
        DATABASE_URL: "postgres://mayarin:mayarin@localhost:5433/mayarin",
        TEST_DATABASE_URL: "postgres://mayarin:mayarin@localhost:5433/mayarin",
      }),
    ).toThrow('not a database ending in "_test"');
  });
});
