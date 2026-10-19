/**
 * Failed passwords per email (SEC-08).
 *
 * The per-IP limiter cannot see a password sprayed at one account from many
 * addresses, so failures are counted per email as typed, known or not, and the
 * wait grows with them. Keyed by what was typed so the wait is no enumeration
 * oracle. The store is a port: in memory it forgets on restart and is per
 * process, a durable one is shared by every replica.
 */

/** Failures an email may make before the wait starts. */
export const FREE_FAILURES = 5;
export const BASE_DELAY_MS = 30_000;
export const MAX_DELAY_MS = 15 * 60_000;

/** How long after the n-th failure the email must wait. */
export function delayAfter(failures: number): number {
  const over = failures - FREE_FAILURES;
  return over < 0 ? 0 : Math.min(BASE_DELAY_MS * 2 ** over, MAX_DELAY_MS);
}

export interface LoginFailures {
  /** Milliseconds the email must still wait, 0 when it may try. */
  waitMs(key: string, now: Date): Promise<number>;
  record(key: string, now: Date): Promise<void>;
  clear(key: string): Promise<void>;
}

/** Bounds the memory a flood of made-up emails can take. */
const MAX_TRACKED = 10_000;

export class InMemoryLoginFailures implements LoginFailures {
  readonly #failures = new Map<string, { count: number; blockedUntil: number }>();

  async waitMs(key: string, now: Date): Promise<number> {
    const entry = this.#failures.get(key);
    return entry === undefined ? 0 : Math.max(0, entry.blockedUntil - now.getTime());
  }

  async record(key: string, now: Date): Promise<void> {
    const at = now.getTime();
    if (this.#failures.size >= MAX_TRACKED && !this.#failures.has(key)) {
      // Drop what has already stopped waiting; if that frees nothing, drop the oldest.
      for (const [tracked, entry] of this.#failures) {
        if (entry.blockedUntil <= at) this.#failures.delete(tracked);
      }
      const oldest = this.#failures.keys().next();
      if (this.#failures.size >= MAX_TRACKED && !oldest.done) this.#failures.delete(oldest.value);
    }
    const count = (this.#failures.get(key)?.count ?? 0) + 1;
    this.#failures.set(key, { count, blockedUntil: at + delayAfter(count) });
  }

  async clear(key: string): Promise<void> {
    this.#failures.delete(key);
  }
}
