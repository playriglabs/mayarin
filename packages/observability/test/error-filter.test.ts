import { describe, expect, test } from "bun:test";
import { createErrorFilter, reportingDsn } from "../src/index.ts";

describe("error filter", () => {
  test("drops a refused request but keeps a server failure", () => {
    const send = createErrorFilter(() => 0);
    expect(send("[api] POST /v1/quotes -> 400 VALIDATION_ERROR: bad amount")).toBe(false);
    expect(send("[api] GET /v1/payments/x -> 502 PROVIDER_ERROR: oracle down")).toBe(true);
  });

  test("sends the same message once a minute", () => {
    let now = 0;
    const send = createErrorFilter(() => now);
    expect(send("[chain-worker] resume pass failed")).toBe(true);
    now = 30_000;
    expect(send("[chain-worker] resume pass failed")).toBe(false);
    now = 61_000;
    expect(send("[chain-worker] resume pass failed")).toBe(true);
  });

  test("a different message is not held back by another", () => {
    const send = createErrorFilter(() => 0);
    expect(send("a")).toBe(true);
    expect(send("b")).toBe(true);
  });
});

describe("reporting gate", () => {
  const dsn = "https://key@o1.ingest.sentry.io/1";

  test("reports only with a DSN on a mainnet deployment", () => {
    expect(reportingDsn({ SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: "mainnet" })).toBe(dsn);
  });

  test("stays silent on a testnet, locally, or with no DSN", () => {
    expect(reportingDsn({ SENTRY_DSN: dsn, SENTRY_ENVIRONMENT: "testnet" })).toBeUndefined();
    expect(reportingDsn({ SENTRY_DSN: dsn })).toBeUndefined();
    expect(reportingDsn({ SENTRY_ENVIRONMENT: "mainnet" })).toBeUndefined();
    expect(reportingDsn({ SENTRY_DSN: "", SENTRY_ENVIRONMENT: "mainnet" })).toBeUndefined();
  });
});
