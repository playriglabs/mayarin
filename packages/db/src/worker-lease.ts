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
  /**
   * This lease's fencing token. Every lease takes the next one, so a worker that
   * lost the lock without noticing holds a smaller token than the worker that
   * took over, and the nonce sequencer refuses to broadcast for it.
   */
  readonly fencingToken: bigint;
  release(): Promise<void>;
}

/** The row the sequencer checks the token against. */
export const CHAIN_WORKER_FENCE = "chain-worker";

export interface WorkerLeaseOptions {
  readonly pollMs?: number;
  readonly onWaiting?: () => void;
  /**
   * Called once if the lock is no longer held. The lock lives on one connection;
   * a network blip or a failover can drop it without this process noticing, and
   * a second worker would then take it while this one keeps submitting. The
   * caller must stop working — exiting and letting the platform restart is the
   * safe answer.
   */
  readonly onLost?: () => void;
  /** How often the lock is checked. */
  readonly checkMs?: number;
}

export async function acquireWorkerLease(
  databaseUrl: string,
  options: WorkerLeaseOptions = {},
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

  // Taken once the lock is held, so tokens follow the order leases were granted.
  const [fence] = await sql<{ token: string }[]>`
    insert into worker_fencing (name, token) values (${CHAIN_WORKER_FENCE}, 1)
    on conflict (name) do update set token = worker_fencing.token + 1
    returning token`;
  if (fence === undefined) throw new Error("Could not take a fencing token for the worker lease");

  const checkMs = options.checkMs ?? 10_000;
  let held = true;
  const watchdog = setInterval(() => {
    void stillHeld(sql, checkMs * 3).then((ok) => {
      if (ok || !held) return;
      held = false;
      clearInterval(watchdog);
      options.onLost?.();
    });
  }, checkMs);

  return {
    fencingToken: BigInt(fence.token),
    release: async () => {
      held = false;
      clearInterval(watchdog);
      // Bounded: after a dropped connection the driver can sit in reconnect backoff.
      await sql.end({ timeout: 2 });
    },
  };
}

/**
 * True while this connection still owns the lock. A failed query counts as lost,
 * and so does one that does not answer in `timeoutMs`: a dropped connection makes
 * the driver reconnect with a backoff, and a check stuck behind it is not evidence
 * that the lock is still held.
 */
async function stillHeld(sql: postgres.Sql, timeoutMs: number): Promise<boolean> {
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([query(sql), timeout]);
}

async function query(sql: postgres.Sql): Promise<boolean> {
  try {
    const [row] = await sql<{ held: boolean }[]>`
      select exists (
        select 1 from pg_locks
        where locktype = 'advisory'
          and pid = pg_backend_pid()
          and objid = ${CHAIN_WORKER_LOCK}
          and granted
      ) as held`;
    return row?.held === true;
  } catch {
    return false;
  }
}
