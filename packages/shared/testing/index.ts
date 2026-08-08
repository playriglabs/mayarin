/**
 * Reference in-memory fakes for the shared ports, in a segregated `/testing`
 * subpath so `src/` stays pure — the same shape every core package uses.
 */

import type { MarketConfigEntry, MarketConfigStore } from "../src/market-config.ts";

/**
 * In-memory market config (#95).
 *
 * Mirrors the Postgres adapter's two write modes exactly: `put` replaces,
 * `putIfAbsent` does nothing when the key exists and reports whether it wrote.
 * A fake that let `putIfAbsent` overwrite would pass a test the real adapter
 * fails, and boot-time seeding is precisely what depends on that difference.
 */
export class InMemoryMarketConfigStore implements MarketConfigStore {
  readonly #byKey = new Map<string, MarketConfigEntry>();

  async all(): Promise<readonly MarketConfigEntry[]> {
    return [...this.#byKey.values()];
  }

  async get(key: string): Promise<MarketConfigEntry | undefined> {
    return this.#byKey.get(key);
  }

  async put(entry: {
    key: string;
    value: unknown;
    updatedAt: Date;
    updatedBy?: string;
  }): Promise<void> {
    this.#byKey.set(entry.key, {
      key: entry.key,
      value: entry.value,
      updatedAt: entry.updatedAt,
      ...(entry.updatedBy === undefined ? {} : { updatedBy: entry.updatedBy }),
    });
  }

  async putIfAbsent(entry: { key: string; value: unknown; updatedAt: Date }): Promise<boolean> {
    if (this.#byKey.has(entry.key)) return false;
    await this.put(entry);
    return true;
  }
}
