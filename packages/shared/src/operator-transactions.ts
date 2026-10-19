/**
 * What the operator key has sent, and what became of it (SEC-04).
 *
 * The nonce sequencer hands out nonces; this is the record of what was done
 * with each one. A durable sequencer writes a row when it allocates a nonce and
 * fills in the hash once the node accepts the broadcast. The reconciler then
 * closes the rows the chain has settled and reports the ones that did not
 * settle on their own:
 *
 * - `stuck`: broadcast, no receipt, the chain has not moved past the nonce.
 * - `replaced`: no receipt for our hash, yet the chain moved past the nonce, so
 *   something else used it (a speed-up from another tool, or a dropped and
 *   re-signed transaction).
 * - `unrecorded`: a nonce was allocated, the hash never recorded, and the chain
 *   moved past it. A broadcast may have landed without us noting it; look.
 * - `reverted`: mined and failed. The nonce is spent, the payment is not.
 *
 * A `stuck` row that kept its call is replaced under the same nonce with fees
 * raised by 12.5%, at most `MAX_BUMPS` times. That bound is the fee cap: three
 * bumps is about 1.4 times the original, so a congested chain cannot run the
 * fee away. Past it, or without a call, the row is only reported.
 */

import type { Clock } from "./clock.ts";
import type { OperatorCall } from "./nonce-sequencer.ts";

export type OperatorTransactionStatus =
  | "allocated"
  | "submitted"
  | "finalized"
  | "reverted"
  | "replaced"
  | "abandoned";

export interface OperatorTransaction {
  readonly id: string;
  /** `${chain}:${address}`, as the sequencer names it. */
  readonly key: string;
  readonly nonce: number;
  readonly status: OperatorTransactionStatus;
  readonly txHash?: string;
  readonly allocatedAt: Date;
  readonly submittedAt?: Date;
  /** Absent when the submitter did not record it; such a row is never replaced. */
  readonly call?: OperatorCall;
  readonly bumpCount: number;
}

export interface OperatorTransactionStore {
  /** Rows still `allocated` or `submitted`. */
  listOpen(): Promise<readonly OperatorTransaction[]>;
  resolve(id: string, status: OperatorTransactionStatus, at: Date): Promise<void>;
  /** The replacement's hash takes the row over, and the grace period starts again. */
  recordBump(id: string, txHash: string, at: Date): Promise<void>;
}

/** Sends the same call again under the row's nonce with higher fees; returns the new hash. */
export interface OperatorTransactionBumper {
  bump(row: OperatorTransaction & { readonly call: OperatorCall }): Promise<string>;
}

export const MAX_BUMPS = 3;

export interface OperatorChainReader {
  /** The key's mined transaction count (`latest`, not pending). */
  confirmedNonce(key: string): Promise<number>;
  /** How the transaction ended, or `undefined` while it has no receipt. */
  receipt(key: string, hash: string): Promise<"success" | "reverted" | undefined>;
}

export interface OperatorTransactionFinding {
  readonly type: "operator-tx";
  readonly finding: "stuck" | "bumped" | "replaced" | "unrecorded" | "reverted";
  readonly id: string;
  readonly key: string;
  readonly nonce: number;
  readonly txHash?: string;
}

/** Long enough for a slow node and a congested block, short enough to notice a stall. */
export const DEFAULT_GRACE_MS = 10 * 60_000;

export interface OperatorTransactionReconcilerOptions {
  readonly store: OperatorTransactionStore;
  readonly chain: OperatorChainReader;
  readonly clock: Clock;
  readonly graceMs?: number;
  /** Absent where nothing can sign, and a stuck transaction is then only reported. */
  readonly bumper?: OperatorTransactionBumper;
}

export class OperatorTransactionReconciler {
  readonly #store: OperatorTransactionStore;
  readonly #chain: OperatorChainReader;
  readonly #clock: Clock;
  readonly #graceMs: number;
  readonly #bumper: OperatorTransactionBumper | undefined;

  constructor(options: OperatorTransactionReconcilerOptions) {
    this.#store = options.store;
    this.#chain = options.chain;
    this.#clock = options.clock;
    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.#bumper = options.bumper;
  }

  /** One pass over the open rows; what needs a person's attention is returned. */
  async run(): Promise<readonly OperatorTransactionFinding[]> {
    const now = this.#clock.now();
    const findings: OperatorTransactionFinding[] = [];
    for (const row of await this.#store.listOpen()) {
      const since = (row.submittedAt ?? row.allocatedAt).getTime();
      if (now.getTime() - since < this.#graceMs) continue;
      const finding = await this.#reconcile(row, now);
      if (finding !== undefined) {
        findings.push({
          type: "operator-tx",
          finding,
          id: row.id,
          key: row.key,
          nonce: row.nonce,
          ...(row.txHash === undefined ? {} : { txHash: row.txHash }),
        });
      }
    }
    return findings;
  }

  async #bump(row: OperatorTransaction, now: Date): Promise<OperatorTransactionFinding["finding"]> {
    const { call } = row;
    if (this.#bumper === undefined || call === undefined || row.bumpCount >= MAX_BUMPS) {
      return "stuck";
    }
    try {
      await this.#store.recordBump(row.id, await this.#bumper.bump({ ...row, call }), now);
      return "bumped";
    } catch (error) {
      // The original may have mined in the meantime ("nonce too low"); the next
      // pass finds its receipt. Anything else stays visible as a stuck row.
      console.error("[operator-tx] bump failed", error);
      return "stuck";
    }
  }

  async #reconcile(
    row: OperatorTransaction,
    now: Date,
  ): Promise<OperatorTransactionFinding["finding"] | undefined> {
    if (row.status === "submitted" && row.txHash !== undefined) {
      const receipt = await this.#chain.receipt(row.key, row.txHash);
      if (receipt === "success") {
        await this.#store.resolve(row.id, "finalized", now);
        return undefined;
      }
      if (receipt === "reverted") {
        await this.#store.resolve(row.id, "reverted", now);
        return "reverted";
      }
      if ((await this.#chain.confirmedNonce(row.key)) > row.nonce) {
        await this.#store.resolve(row.id, "replaced", now);
        return "replaced";
      }
      return this.#bump(row, now);
    }

    // Allocated and never recorded: either the send failed before the node saw
    // it, or it landed and we crashed before noting the hash.
    const landed = (await this.#chain.confirmedNonce(row.key)) > row.nonce;
    await this.#store.resolve(row.id, "abandoned", now);
    return landed ? "unrecorded" : undefined;
  }
}

/** Reference store for tests and a deployment with no database. */
export class InMemoryOperatorTransactionStore implements OperatorTransactionStore {
  readonly rows: OperatorTransaction[] = [];

  async listOpen(): Promise<readonly OperatorTransaction[]> {
    return this.rows.filter((row) => row.status === "allocated" || row.status === "submitted");
  }

  async resolve(id: string, status: OperatorTransactionStatus): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    const row = this.rows[index];
    if (row !== undefined) this.rows[index] = { ...row, status };
  }

  async recordBump(id: string, txHash: string, at: Date): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    const row = this.rows[index];
    if (row !== undefined) {
      this.rows[index] = { ...row, txHash, submittedAt: at, bumpCount: row.bumpCount + 1 };
    }
  }
}
