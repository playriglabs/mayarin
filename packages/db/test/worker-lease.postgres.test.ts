/**
 * The chain worker's lease (SEC-04) against a real Postgres.
 *
 * An advisory lock is a property of a database session, so the fake cannot say
 * anything about it. Keys on `TEST_DATABASE_URL` only, like the rest of the
 * Postgres suites, so a plain `bun test` never touches a real database.
 */

import { describe, expect, test } from "bun:test";
import postgres from "postgres";
import { acquireWorkerLease } from "../src/worker-lease.ts";
import { guardedTestDatabaseUrl } from "./database-guard.ts";

const URL = guardedTestDatabaseUrl(process.env);

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe.skipIf(URL === undefined)("worker lease", () => {
  test("a second worker waits while the first holds the lease", async () => {
    const first = await acquireWorkerLease(URL as string);
    let waited = false;
    let second: Awaited<ReturnType<typeof acquireWorkerLease>> | undefined;
    const pending = acquireWorkerLease(URL as string, {
      pollMs: 20,
      onWaiting: () => {
        waited = true;
      },
    }).then((lease) => {
      second = lease;
    });

    await waitFor(() => waited);
    expect(second).toBeUndefined();

    await first.release();
    await pending;
    expect(second).toBeDefined();
    await second?.release();
  });

  test("each lease takes a larger fencing token than the one before (SEC-04)", async () => {
    const first = await acquireWorkerLease(URL as string);
    const before = first.fencingToken;
    await first.release();

    const second = await acquireWorkerLease(URL as string);
    expect(second.fencingToken).toBe(before + 1n);
    await second.release();
  });

  test("reports the lease lost when its connection is killed", async () => {
    let lost = 0;
    const lease = await acquireWorkerLease(URL as string, {
      pollMs: 20,
      checkMs: 20,
      onLost: () => lost++,
    });
    const admin = postgres(URL as string, { max: 1 });
    try {
      // Drop the session holding the lock, as a failover or a network cut would.
      await admin`
        select pg_terminate_backend(pid) from pg_locks
        where locktype = 'advisory' and granted and objid = ${7_243_001}`;
      await waitFor(() => lost > 0);
      expect(lost).toBe(1);
    } finally {
      await admin.end();
      await lease.release();
    }
  });

  test("does not report a healthy lease as lost", async () => {
    let lost = 0;
    const lease = await acquireWorkerLease(URL as string, {
      pollMs: 20,
      checkMs: 20,
      onLost: () => lost++,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(lost).toBe(0);
    await lease.release();
  });
});
