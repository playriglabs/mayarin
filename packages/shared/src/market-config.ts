/**
 * Runtime market configuration (#95).
 *
 * Three kinds of configuration live in this codebase and only two of them
 * belong in the environment:
 *
 * - **Deployment identity** — router addresses, the deposit-forwarder init code
 *   hash, the treasury address, operator keys. These change only on a redeploy,
 *   and two of them are load-bearing in a way that argues against ever making
 *   them runtime-editable: the init code hash determines every deposit address
 *   ever issued, and a mutable treasury address is a redirect of funds. They
 *   stay in `.env`, boot-validated.
 * - **Merchant configuration** — settlement address, settlement asset, accepted
 *   assets. Already per-merchant rows; the dashboard API writes them.
 * - **Market data** — which stablecoins are admitted, which oracle feed serves a
 *   pair, which pool prices a swap. None of these are properties of *this*
 *   deployment; they are facts about the market that change far more often than
 *   a deploy. That is what this port is for.
 *
 * The store is deliberately untyped. Every value here already has a zod schema
 * that parses it out of an environment string, and reusing that schema to parse
 * the stored JSON keeps one definition of what each value may be — rather than
 * a second one here that can disagree with it.
 */

export interface MarketConfigEntry {
  readonly key: string;
  readonly value: unknown;
  readonly updatedAt: Date;
  /** The account that wrote it. Absent for values seeded from the environment. */
  readonly updatedBy?: string;
}

export interface MarketConfigStore {
  all(): Promise<readonly MarketConfigEntry[]>;
  get(key: string): Promise<MarketConfigEntry | undefined>;
  /** Writes or replaces one key. */
  put(entry: { key: string; value: unknown; updatedAt: Date; updatedBy?: string }): Promise<void>;
  /**
   * Writes a key only if it is absent.
   *
   * How the environment seeds an empty deployment exactly once. A plain `put`
   * would overwrite a value an operator had already changed at every boot,
   * which would make the whole feature a no-op that looks like it works.
   */
  putIfAbsent(entry: { key: string; value: unknown; updatedAt: Date }): Promise<boolean>;
}

/**
 * A token that changes whenever any entry does.
 *
 * Consumers rebuild what they derived from market data when this changes, which
 * is what makes "no restart needed" true without anything watching the database.
 */
export function marketConfigVersion(entries: readonly MarketConfigEntry[]): string {
  const newest = entries.reduce((max, entry) => Math.max(max, entry.updatedAt.getTime()), 0);
  return `${entries.length}:${newest}`;
}
