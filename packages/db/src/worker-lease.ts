/**
 * Single-writer lease for the chain worker (SEC-04).
 *
 * The watcher's overlap guard and the executor's nonce queue are in-process, so
 * a second worker (a rolling deploy, an operator's duplicate) would submit
 * conflicting transactions. A Postgres session advisory lock makes "one worker"
 * a fact the database enforces rather than a deployment setting.
 *
 * Held on a connection of its own: the application pool recycles connections,
 * and a recycled one would drop the lock without the process noticing. The
 * lock dies with the connection, so a crashed worker releases it by itself and
 * the waiting one takes over.
 */

import postgres from "postgres";

/** Arbitrary, but fixed: every worker of every deployment on this database. */
const CHAIN_WORKER_LOCK = 7_243_001;

export interface WorkerLease {
  release(): Promise<void>;
}

export async function acquireWorkerLease(
  databaseUrl: string,
  options: { readonly pollMs?: number; readonly onWaiting?: () => void } = {},
): Promise<WorkerLease> {
  const sql = postgres(databaseUrl, { max: 1, idle_timeout: 0, max_lifetime: null });
  const pollMs = options.pollMs ?? 5_000;

  for (;;) {
    const [row] = await sql<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${CHAIN_WORKER_LOCK}) as locked`;
    if (row?.locked === true) break;
    options.onWaiting?.();
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return { release: () => sql.end() };
}
