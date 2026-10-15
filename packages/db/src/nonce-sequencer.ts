/**
 * Cross-process nonce sequencing on Postgres (SEC-04).
 *
 * A transaction-scoped advisory lock per key makes "read the pending nonce and
 * broadcast" exclusive across every process that signs with the operator key —
 * the chain worker, the API's x402 paths, a duplicate or an overlapping deploy.
 * The next nonce is kept in a row so a process that did not make the last
 * broadcast still honours it when its node has not seen it yet.
 *
 * The stored floor is trusted only for `FLOOR_TTL_MS`. A broadcast that was
 * accepted and then dropped from the mempool would otherwise leave the floor
 * one past the chain forever, and every later transaction would wait on a gap.
 * Propagation lag is seconds, so the window is far longer than the problem and
 * far shorter than a stall.
 */

import type { Clock, NonceSequencer } from "@mayarin/shared";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "./client.ts";
import { runInTransaction } from "./mapping.ts";
import { operatorNonces } from "./schema.ts";

export const FLOOR_TTL_MS = 60_000;

export class PostgresNonceSequencer implements NonceSequencer {
  readonly #db: Executor;
  readonly #clock: Clock;

  constructor(db: Executor, clock: Clock) {
    this.#db = db;
    this.#clock = clock;
  }

  async broadcast<T>(
    key: string,
    observed: () => Promise<number>,
    send: (nonce: number) => Promise<T>,
  ): Promise<T> {
    try {
      return await runInTransaction(this.#db, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`nonce:${key}`}))`);
        const [row] = await tx
          .select()
          .from(operatorNonces)
          .where(eq(operatorNonces.key, key))
          .limit(1);
        const now = this.#clock.now();
        const floor =
          row !== undefined && now.getTime() - row.updatedAt.getTime() < FLOOR_TTL_MS
            ? row.nextNonce
            : 0;

        const nonce = Math.max(await observed(), floor);
        const result = await send(nonce);

        await tx
          .insert(operatorNonces)
          .values({ key, nextNonce: nonce + 1, updatedAt: now })
          .onConflictDoUpdate({
            target: operatorNonces.key,
            set: { nextNonce: nonce + 1, updatedAt: now },
          });
        return result;
      });
    } catch (error) {
      // Rebuild from the chain next time, as the in-memory sequencer does.
      await this.#db.delete(operatorNonces).where(eq(operatorNonces.key, key));
      throw error;
    }
  }
}
