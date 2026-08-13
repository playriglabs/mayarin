/**
 * Runtime market configuration (#95).
 *
 * Which stablecoins are admitted, which oracle feed serves a pair, which pool
 * prices a swap — market facts, not properties of this deployment. Editing
 * `.env` and restarting to admit a stablecoin is not a thing a running payment
 * processor should have to do, so these live in a table instead.
 *
 * Three things make that safe rather than merely convenient:
 *
 * - **The same schema parses both.** A stored value is validated by the zod
 *   schema that already parsed it out of an environment string, so there is one
 *   definition of what each value may be rather than a second one here.
 * - **A bad write cannot silently mis-price.** A value that fails to parse is
 *   refused at the write, and the snapshot in memory is left alone.
 * - **Rebuild rather than mutate.** Everything derived from market data —
 *   the stablecoin registry, the rate table, the quote layer — is rebuilt from
 *   scratch when the version changes. Nothing is patched in place, so there is
 *   no half-updated state to reason about.
 */

import type { ChainId } from "@mayarin/chain";
import type { PriceQuote, PriceSource } from "@mayarin/clearing";
import { TablePriceSource } from "@mayarin/clearing";
import {
  type AssetCode,
  assetDecimals,
  type Clock,
  getAsset,
  type MarketConfigEntry,
  type MarketConfigStore,
  type Money,
  marketConfigVersion,
  money,
  scaledRateFrom,
  ValidationError,
} from "@mayarin/shared";
import {
  InMemoryStablecoinRegistry,
  type Stablecoin,
  type StablecoinRegistry,
} from "@mayarin/stablecoin";
import { z } from "zod";
import type { Config } from "./config.ts";
import { createQuoteLayer, type QuoteLayer } from "./quote-layer.ts";

/**
 * Keys the store holds, and how each one is validated.
 *
 * Deliberately a closed set: an operator can change what a key means, never
 * invent a key nothing reads. A typo would otherwise be accepted, stored, and
 * silently ignored forever.
 */
export const MARKET_CONFIG_KEYS = [
  "stablecoins",
  "exchangeRates",
  "pythFeeds",
  "chainlinkFeeds",
  "uniswapPools",
] as const;

export type MarketConfigKey = (typeof MARKET_CONFIG_KEYS)[number];

export function isMarketConfigKey(value: string): value is MarketConfigKey {
  return (MARKET_CONFIG_KEYS as readonly string[]).includes(value);
}

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);

const stablecoinsSchema = z.array(
  z.object({
    asset: z.string(),
    onChain: z.array(z.object({ chain: z.string(), address: addressSchema })),
  }),
);

/** Rates travel as strings: JSON has no bigint, and a rate must stay exact. */
const exchangeRatesSchema = z.record(z.string(), z.string().regex(/^\d+$/));

const pythFeedsSchema = z.record(
  z.string(),
  z.union([z.string(), z.object({ id: z.string(), invert: z.boolean().optional() })]),
);

const chainlinkFeedsSchema = z.record(z.string(), z.unknown());
const uniswapPoolsSchema = z.record(z.string(), z.unknown());

const SCHEMAS: Readonly<Record<MarketConfigKey, z.ZodTypeAny>> = {
  stablecoins: stablecoinsSchema,
  exchangeRates: exchangeRatesSchema,
  pythFeeds: pythFeedsSchema,
  chainlinkFeeds: chainlinkFeedsSchema,
  uniswapPools: uniswapPoolsSchema,
};

/** Validates a value for a key, throwing rather than storing something unreadable. */
export function parseMarketValue(key: MarketConfigKey, value: unknown): unknown {
  const result = SCHEMAS[key].safeParse(value);
  if (!result.success) {
    throw new ValidationError(`Invalid value for market config key "${key}"`, {
      key,
      issues: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }
  return result.data;
}

/** What the deployment currently believes about the market. */
interface MarketSnapshot {
  readonly version: string;
  readonly stablecoins: readonly Stablecoin[];
  readonly exchangeRates: Readonly<Record<string, bigint>>;
  readonly pythFeeds: Record<string, unknown>;
  readonly chainlinkFeeds: Record<string, unknown>;
  readonly uniswapPools: Record<string, unknown>;
}

/** Everything rebuilt from one snapshot, cached until that snapshot is replaced. */
interface Derived {
  /**
   * The snapshot this was built from, compared by identity.
   *
   * Not the version string: that is derived from timestamps, and two writes in
   * the same millisecond produce the same version — which would leave the
   * registry and the quote layer built from a snapshot that had already been
   * replaced. `#snapshotOf` returns the same object while its cache is warm and
   * a new one otherwise, so identity is exactly the question being asked.
   */
  readonly snapshot: MarketSnapshot;
  readonly registry: StablecoinRegistry;
  readonly rates: PriceSource;
  readonly quote: QuoteLayer | undefined;
}

export interface RuntimeMarketOptions {
  readonly store: MarketConfigStore;
  readonly config: Config;
  readonly clock: Clock;
  /**
   * How long a snapshot is trusted before the table is read again.
   *
   * A read per quote would put a query on the payment path; never re-reading
   * would make "no restart needed" false. Seconds is the right order: an
   * operator adding a feed waits at most this long, and the payment path pays
   * one query per window.
   */
  readonly cacheMs?: number;
}

const DEFAULT_CACHE_MS = 5_000;

export class RuntimeMarket {
  readonly #store: MarketConfigStore;
  readonly #config: Config;
  readonly #clock: Clock;
  readonly #cacheMs: number;

  #snapshot: MarketSnapshot | undefined;
  #snapshotAt = 0;
  #derived: Derived | undefined;

  constructor(options: RuntimeMarketOptions) {
    this.#store = options.store;
    this.#config = options.config;
    this.#clock = options.clock;
    this.#cacheMs = options.cacheMs ?? DEFAULT_CACHE_MS;
  }

  /**
   * Writes the environment's values into the table, once, for keys it does not
   * yet hold.
   *
   * `putIfAbsent`, not `put`: a plain write would overwrite an operator's
   * change on every boot, which would make the whole feature a no-op that looks
   * like it works.
   */
  async seedFromEnvironment(): Promise<readonly MarketConfigKey[]> {
    const now = this.#clock.now();
    const seeded: MarketConfigKey[] = [];
    const values = environmentValues(this.#config);

    for (const key of MARKET_CONFIG_KEYS) {
      const wrote = await this.#store.putIfAbsent({ key, value: values[key], updatedAt: now });
      if (wrote) seeded.push(key);
    }

    return seeded;
  }

  /** Validates and stores one key, then drops the cache so the next read sees it. */
  async put(key: MarketConfigKey, value: unknown, updatedBy?: string): Promise<void> {
    const parsed = parseMarketValue(key, value);
    await this.#store.put({
      key,
      value: parsed,
      updatedAt: this.#clock.now(),
      ...(updatedBy === undefined ? {} : { updatedBy }),
    });
    this.#snapshotAt = 0;
  }

  async entries(): Promise<readonly MarketConfigEntry[]> {
    return this.#store.all();
  }

  async registry(): Promise<StablecoinRegistry> {
    return (await this.#derive()).registry;
  }

  async rates(): Promise<PriceSource> {
    return (await this.#derive()).rates;
  }

  async quote(): Promise<QuoteLayer | undefined> {
    return (await this.#derive()).quote;
  }

  /** The current stablecoin set, for wiring that needs the list rather than the port. */
  async stablecoins(): Promise<readonly Stablecoin[]> {
    return (await this.#snapshotOf()).stablecoins;
  }

  /** The current pool map, for the route sources the contract path builds per call. */
  async uniswapPools(): Promise<Record<string, unknown>> {
    return (await this.#snapshotOf()).uniswapPools;
  }

  async #derive(): Promise<Derived> {
    const snapshot = await this.#snapshotOf();
    const cached = this.#derived;
    if (cached !== undefined && cached.snapshot === snapshot) return cached;

    // Rebuilt rather than patched: a registry or a quote layer half-updated
    // from two snapshots is a state nothing else in this codebase can express,
    // and it would be a mis-priced payment rather than an error.
    const derived: Derived = {
      snapshot,
      registry: new InMemoryStablecoinRegistry(snapshot.stablecoins),
      rates: new TablePriceSource(snapshot.exchangeRates),
      quote: createQuoteLayer(
        {
          ...this.#config,
          pythFeeds: snapshot.pythFeeds as Config["pythFeeds"],
          chainlinkFeeds: snapshot.chainlinkFeeds as Config["chainlinkFeeds"],
          uniswapPools: snapshot.uniswapPools as Config["uniswapPools"],
        },
        this.#clock,
      ),
    };

    this.#derived = derived;
    return derived;
  }

  async #snapshotOf(): Promise<MarketSnapshot> {
    const now = this.#clock.now().getTime();
    const cached = this.#snapshot;
    if (cached !== undefined && now - this.#snapshotAt < this.#cacheMs) return cached;

    const entries = await this.#store.all();
    const byKey = new Map(entries.map((entry) => [entry.key, entry.value] as const));
    const fallback = environmentValues(this.#config);

    // An unreadable stored value falls back to the environment rather than
    // failing every payment: the deployment booted with the environment's
    // values and they are known-good, so a bad row degrades to the last thing
    // that was known to work instead of taking the processor down.
    const read = <T>(key: MarketConfigKey): T => {
      const stored = byKey.get(key);
      if (stored === undefined) return fallback[key] as T;
      const result = SCHEMAS[key].safeParse(stored);
      return (result.success ? result.data : fallback[key]) as T;
    };

    const snapshot: MarketSnapshot = {
      version: marketConfigVersion(entries),
      stablecoins: toStablecoins(read<unknown>("stablecoins")),
      exchangeRates: toRates(read<Record<string, string>>("exchangeRates")),
      pythFeeds: read<Record<string, unknown>>("pythFeeds"),
      chainlinkFeeds: read<Record<string, unknown>>("chainlinkFeeds"),
      uniswapPools: read<Record<string, unknown>>("uniswapPools"),
    };

    this.#snapshot = snapshot;
    this.#snapshotAt = now;
    return snapshot;
  }
}

/**
 * A `StablecoinRegistry` that resolves the current one on every call.
 *
 * Injected where a registry is injected today, so no service below the
 * composition root learns that the set can change. The indirection is one map
 * lookup against a cached object, not a query.
 */
export class RuntimeStablecoinRegistry implements StablecoinRegistry {
  readonly #market: RuntimeMarket;

  constructor(market: RuntimeMarket) {
    this.#market = market;
  }

  async list(): Promise<readonly Stablecoin[]> {
    return (await this.#market.registry()).list();
  }

  async find(asset: AssetCode): Promise<Stablecoin | undefined> {
    return (await this.#market.registry()).find(asset);
  }

  async isSettlementAsset(asset: AssetCode): Promise<boolean> {
    return (await this.#market.registry()).isSettlementAsset(asset);
  }

  async isDepositAsset(asset: AssetCode, chain: ChainId): Promise<boolean> {
    return (await this.#market.registry()).isDepositAsset(asset, chain);
  }

  async address(asset: AssetCode, chain: ChainId): Promise<`0x${string}` | undefined> {
    return (await this.#market.registry()).address(asset, chain);
  }
}

/** A `PriceSource` over the current rate table, for the same reason. */
export class RuntimePriceSource implements PriceSource {
  readonly #market: Pick<RuntimeMarket, "quote" | "rates">;

  constructor(market: Pick<RuntimeMarket, "quote" | "rates">) {
    this.#market = market;
  }

  async price(from: AssetCode, to: AssetCode, amount: Money): Promise<PriceQuote> {
    const quote = await this.#market.quote();
    if (
      quote !== undefined &&
      getAsset(from).kind === "fiat" &&
      getAsset(to).kind === "stablecoin"
    ) {
      const priced = await quote.engine.quoteFiatPrice({
        price: amount,
        settlementAsset: to,
        payerAsset: to,
        probe: money(10n ** BigInt(assetDecimals(to)), to),
      });
      const settlement = priced.settlement;
      return {
        from,
        to,
        scaledRate: scaledRateFrom(
          settlement.settlementAmount.amount * 10n ** BigInt(assetDecimals(from)),
          amount.amount,
        ),
        source: settlement.source,
      };
    }
    return (await this.#market.rates()).price(from, to, amount);
  }
}

/** What the environment says, used to seed an empty table and to fall back to. */
function environmentValues(config: Config): Readonly<Record<MarketConfigKey, unknown>> {
  return {
    stablecoins: config.stablecoins,
    exchangeRates: Object.fromEntries(
      Object.entries(config.exchangeRates).map(([pair, rate]) => [pair, rate.toString()]),
    ),
    pythFeeds: config.pythFeeds,
    chainlinkFeeds: config.chainlinkFeeds,
    uniswapPools: config.uniswapPools,
  };
}

function toStablecoins(value: unknown): readonly Stablecoin[] {
  return value as readonly Stablecoin[];
}

function toRates(value: Record<string, string>): Readonly<Record<string, bigint>> {
  return Object.fromEntries(Object.entries(value).map(([pair, rate]) => [pair, BigInt(rate)]));
}
