/**
 * Rail observations, cached and survivable.
 *
 * `SubgraphRailObservations` answers by querying The Graph, and the caller here
 * is `paymentRequired` — one call per `402`. Read straight through, a resource
 * under any load at all would spend a metered query per request, which is the
 * same arithmetic that took the settlement indexer down: a Studio development
 * URL allows 3,000 queries a day.
 *
 * Two behaviours, both of them the composition root's decision rather than the
 * port's:
 *
 * - **Cached for `ttlMs`.** The number being read is a median over the last
 *   hundred settlements; it does not move between two requests a second apart,
 *   and pretending otherwise buys nothing.
 * - **An outage degrades instead of failing.** The port throws on an
 *   unreachable subgraph on purpose — an outage and a rail that never settled
 *   are different facts, and only a caller can decide which matters. This
 *   caller decides: a `402` must still be served, so a failed read serves the
 *   last good answer, or none at all, and `chooseRail` then says `unobserved`
 *   out loud rather than presenting a fallback as a decision.
 */

import type { ChainId } from "@mayarin/chain";
import type { RailObservation, RailObservationSource } from "@mayarin/x402";

interface Logger {
  warn(message: string): void;
}

export interface CachedRailObservationsOptions {
  readonly source: RailObservationSource;
  /** How long one read is reused. */
  readonly ttlMs: number;
  readonly now: () => Date;
  readonly logger?: Logger;
}

interface Entry {
  readonly observations: readonly RailObservation[];
  readonly readAt: number;
}

export class CachedRailObservations implements RailObservationSource {
  readonly #options: CachedRailObservationsOptions;
  readonly #entries = new Map<string, Entry>();

  constructor(options: CachedRailObservationsOptions) {
    this.#options = options;
  }

  async observe(chains: readonly ChainId[]): Promise<readonly RailObservation[]> {
    // Keyed by the set asked for, sorted, because two resources accepting
    // different chains are two different questions with two different answers.
    const key = [...chains].sort().join(",");
    const now = this.#options.now().getTime();
    const cached = this.#entries.get(key);
    if (cached !== undefined && now - cached.readAt < this.#options.ttlMs) {
      return cached.observations;
    }

    try {
      const observations = await this.#options.source.observe(chains);
      this.#entries.set(key, { observations, readAt: now });
      return observations;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.#options.logger?.warn(
        `[rails] could not read observations for ${key}: ${reason}; ${
          cached === undefined ? "no rail is observed" : "serving the last good read"
        }`,
      );
      // Deliberately not re-stamped: a stale answer must keep expiring, or one
      // outage would freeze the last good read in place for as long as the
      // process lives.
      return cached?.observations ?? [];
    }
  }
}
