/**
 * A cache that stays fast after its answers age.
 *
 * An answer younger than `freshMs` is served as it is. One older, but younger than
 * `staleMs`, is *still served at once* while a fresh one is fetched behind it, so the
 * caller who happens to arrive after the window never pays for the lookup. Only a key with
 * no usable answer waits, and every caller asking for it at the same moment waits on one
 * fetch rather than starting its own.
 *
 * `load` says whether its result may be remembered. An answer that is only the absence of
 * one (a rate limit, an unreachable service) is returned to the caller who asked but never
 * stored, so it can neither replace a good stale answer nor outlive the moment it describes.
 */

export interface Loaded<V> {
  readonly value: V;
  /** Whether this is a real answer worth keeping, or the absence of one. */
  readonly keep: boolean;
}

export interface StaleCacheOptions<V> {
  readonly freshMs: number;
  readonly staleMs: number;
  readonly load: (key: string) => Promise<Loaded<V>>;
  /** Milliseconds; replaceable so a test need not wait. */
  readonly now?: () => number;
}

export class StaleCache<V> {
  readonly #freshMs: number;
  readonly #staleMs: number;
  readonly #load: (key: string) => Promise<Loaded<V>>;
  readonly #now: () => number;
  readonly #answers = new Map<string, { readonly at: number; readonly value: V }>();
  readonly #inFlight = new Map<string, Promise<V>>();

  constructor(options: StaleCacheOptions<V>) {
    this.#freshMs = options.freshMs;
    this.#staleMs = options.staleMs;
    this.#load = options.load;
    this.#now = options.now ?? Date.now;
  }

  async get(key: string): Promise<V> {
    const cached = this.#answers.get(key);
    if (cached !== undefined) {
      const age = this.#now() - cached.at;
      if (age < this.#freshMs) return cached.value;
      if (age < this.#staleMs) {
        // Answer now; the refresh is not the caller's to wait for, or to fail on.
        this.#refresh(key).catch(() => undefined);
        return cached.value;
      }
    }
    return this.#refresh(key);
  }

  #refresh(key: string): Promise<V> {
    const running = this.#inFlight.get(key);
    if (running !== undefined) return running;

    const fetching = this.#load(key)
      .then(({ value, keep }) => {
        if (keep) this.#answers.set(key, { at: this.#now(), value });
        return value;
      })
      .finally(() => this.#inFlight.delete(key));
    this.#inFlight.set(key, fetching);
    return fetching;
  }
}
