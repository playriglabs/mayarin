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
 * It reports; it does not rebroadcast. A transaction that needs replacing is a
 * decision about fees and intent that a person makes with the finding in hand.
 */

import type { Clock } from "./clock.ts";

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
}

export interface OperatorTransactionStore {
  /** Rows still `allocated` or `submitted`. */
  listOpen(): Promise<readonly OperatorTransaction[]>;
  resolve(id: string, status: OperatorTransactionStatus, at: Date): Promise<void>;
}

export interface OperatorChainReader {
  /** The key's mined transaction count (`latest`, not pending). */
  confirmedNonce(key: string): Promise<number>;
  /** How the transaction ended, or `undefined` while it has no receipt. */
  receipt(key: string, hash: string): Promise<"success" | "reverted" | undefined>;
}

export interface OperatorTransactionFinding {
  readonly type: "operator-tx";
  readonly finding: "stuck" | "replaced" | "unrecorded" | "reverted";
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
}

export class OperatorTransactionReconciler {
  readonly #store: OperatorTransactionStore;
  readonly #chain: OperatorChainReader;
  readonly #clock: Clock;
  readonly #graceMs: number;

  constructor(options: OperatorTransactionReconcilerOptions) {
    this.#store = options.store;
    this.#chain = options.chain;
    this.#clock = options.clock;
    this.#graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
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
      return "stuck";
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
}
