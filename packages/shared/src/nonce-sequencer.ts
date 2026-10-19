/**
 * Nonce sequencing for one signing key (SEC-04).
 *
 * A nonce belongs to a key on one chain, not to a payment, and several
 * submitters in more than one process sign with the operator key. Whoever
 * reads the pending nonce and broadcasts must be the only one doing so, or two
 * of them bid the same slot and one payment sticks.
 *
 * `key` names the sequence — `${chain}:${address}` — so independent keys and
 * chains never wait on each other.
 */
/** The call a nonce was spent on; a replacement must repeat it exactly. */
export interface OperatorCall {
  readonly to: string;
  readonly data: string;
  readonly value: bigint;
}

export interface NonceSequencer {
  /**
   * Runs `send` as the only holder of `key`, with the lowest nonce it may use:
   * the chain's pending count (`observed`), raised to the one after the last
   * nonce this sequencer handed out, because a node may not have seen that
   * broadcast yet. The counter advances only when `send` resolves.
   *
   * `send` returns the transaction hash. A durable sequencer records it against
   * the nonce, which is what lets `OperatorTransactionReconciler` tell a
   * finalized transaction from a stuck, replaced or never-recorded one.
   *
   * `call` is what `send` sends. A durable sequencer keeps it so a stuck
   * transaction can be replaced; without it the row is only ever reported.
   */
  broadcast<T extends string>(
    key: string,
    observed: () => Promise<number>,
    send: (nonce: number) => Promise<T>,
    call?: OperatorCall,
  ): Promise<T>;
}

/** One process only; use the Postgres sequencer wherever two processes sign. */
export class InMemoryNonceSequencer implements NonceSequencer {
  readonly #queues = new Map<string, Promise<unknown>>();
  readonly #next = new Map<string, number>();

  broadcast<T extends string>(
    key: string,
    observed: () => Promise<number>,
    send: (nonce: number) => Promise<T>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const remembered = this.#next.get(key);
      const seen = await observed();
      const nonce = remembered === undefined ? seen : Math.max(seen, remembered);
      try {
        const result = await send(nonce);
        this.#next.set(key, nonce + 1);
        return result;
      } catch (error) {
        // A dropped nonce would stall every later submission, so the counter
        // is rebuilt from the chain on the next attempt rather than trusted.
        this.#next.delete(key);
        throw error;
      }
    };
    const queued = this.#queues.get(key) ?? Promise.resolve();
    const result = queued.then(run, run);
    // The queue must not inherit a rejection, or one failed submission would
    // reject every later one without ever running it.
    this.#queues.set(
      key,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    return result;
  }
}
