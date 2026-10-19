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
 *
 * Every nonce is also written to `operator_transactions`, outside the lock's
 * transaction so the row survives a crash or a rollback: `allocated` before the
 * send, `submitted` with the hash after. The reconciler reads those rows.
 *
 * Those writes go through their own small pool (`outbox`). Each submitter holds
 * a pooled connection for the whole lock; if the writes queued on the same
 * pool, enough waiting submitters would take every connection and the one
 * holding the lock could never record its own nonce.
 */

import { type Clock, generateId, ID_PREFIXES, type NonceSequencer } from "@mayarin/shared";
import { eq, sql } from "drizzle-orm";
import type { Executor } from "./client.ts";
import { runInTransaction } from "./mapping.ts";
import { operatorNonces, operatorTransactions } from "./schema.ts";

export const FLOOR_TTL_MS = 60_000;

export class PostgresNonceSequencer implements NonceSequencer {
  readonly #db: Executor;
  readonly #clock: Clock;
  readonly #outbox: Executor;

  constructor(db: Executor, clock: Clock, outbox: Executor) {
    this.#db = db;
    this.#clock = clock;
    this.#outbox = outbox;
  }

  async broadcast<T extends string>(
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
        const id = generateId(ID_PREFIXES.operatorTransaction, now.getTime());
        // Before the send and on its own connection: if we die mid-broadcast,
        // this row is the only trace that the nonce was in play.
        await this.#outbox.insert(operatorTransactions).values({
          id,
          key,
          nonce,
          status: "allocated",
          allocatedAt: now,
        });
        let result: T;
        try {
          result = await send(nonce);
        } catch (error) {
          await this.#close(id, "abandoned");
          throw error;
        }
        await this.#recordHash(id, result);

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

  /**
   * The broadcast already happened, so a failure here must not look like one:
   * the caller would retry and send twice. The row stays `allocated`, which the
   * reconciler reports.
   */
  async #recordHash(id: string, hash: string): Promise<void> {
    try {
      await this.#outbox
        .update(operatorTransactions)
        .set({ status: "submitted", txHash: hash, submittedAt: this.#clock.now() })
        .where(eq(operatorTransactions.id, id));
    } catch (error) {
      console.error("[nonce-sequencer] could not record a broadcast hash", error);
    }
  }

  async #close(id: string, status: "abandoned"): Promise<void> {
    try {
      await this.#outbox
        .update(operatorTransactions)
        .set({ status, resolvedAt: this.#clock.now() })
        .where(eq(operatorTransactions.id, id));
    } catch (error) {
      console.error("[nonce-sequencer] could not close an operator transaction", error);
    }
  }
}
