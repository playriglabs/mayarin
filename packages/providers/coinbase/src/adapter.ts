/**
 * Coinbase Exchange price oracle adapter.
 *
 * Implements the `PriceOracle` port over the public Exchange ticker, as the
 * crypto reference the venue's executable price is guarded against.
 *
 * **Why a third oracle.** Pyth's grant is a per-feed allowlist of majors, and
 * which feeds are in it is not predictable from the asset class: probed on one
 * default key, `SOL/USD` answers 200 while `SUI/USD` and `ARB/USD` answer
 * `403 Not entitled`. Discovering that per asset, in production, is what this
 * source exists to stop. Coinbase needs no key, no account and no grant that
 * can be revoked, and it lists every payer asset Pyth denies. Composed under
 * `FallbackPriceOracle`, a new payer asset is covered by at least one source on
 * the day it is added.
 *
 * **What it is not.** A single venue's last trade, not a cross-venue aggregate.
 * That is honest for a deviation guard — it is independent of the DEX pool it
 * guards, which is the only property the guard needs — but on a thin pair the
 * aggregate would be the better reference. Prefer it as a secondary source and
 * let `FallbackPriceOracle` cross-check it against the primary.
 *
 * The `feeds` map is deployment configuration from pair to product id, and it
 * owns the equivalence: naming `ETH-USD` as the reference for `ETH/USDC` is the
 * deployment stating that USDC holds its dollar peg closely enough to price
 * against. Every product is quoted in USD and every pair asked of this oracle
 * is `<asset>/<dollar stablecoin>`, so no inversion arises; a pair needing one
 * is a `ConfigurationError` rather than a silently reciprocated rate.
 */

import type { OraclePrice, PriceOracle } from "@mayarin/clearing";
import { rateKey } from "@mayarin/clearing";
import {
  type AssetCode,
  assetDecimals,
  type Clock,
  ConfigurationError,
  ProviderError,
  systemClock,
} from "@mayarin/shared";
import {
  coinbaseTickerSchema,
  type DecimalPrice,
  scaleTickerPrice,
  splitDecimalPrice,
} from "./ticker.ts";

export const DEFAULT_COINBASE_ENDPOINT = "https://api.exchange.coinbase.com";

/**
 * How long an observation is reused before the ticker is read again.
 *
 * The public endpoint is rate limited per IP, and the oracle sits on the hot
 * path — every quote and every checkout preview reads it. Ten seconds keeps a
 * burst of previews to one request while staying far inside the 60 second
 * freshness bound a deployment typically sets. It cannot fake freshness: what
 * is cached is the trade's own timestamp, so a cached price ages as the guard
 * expects.
 */
export const DEFAULT_COINBASE_CACHE_SECONDS = 10;

export interface CoinbasePriceOracleOptions {
  /** Pair (`rateKey(from, to)`) to product id, e.g. `"ETH/USDC": "ETH-USD"`. */
  readonly feeds: Readonly<Record<string, string>>;
  readonly endpoint?: string;
  /** Observation reuse window; defaults to `DEFAULT_COINBASE_CACHE_SECONDS`. */
  readonly cacheSeconds?: number;
  readonly clock?: Clock;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

interface Observation {
  readonly price: DecimalPrice;
  readonly observedAt: Date;
  /** When the reuse window closes, in epoch milliseconds. */
  readonly expiresAtMs: number;
}

export class CoinbasePriceOracle implements PriceOracle {
  readonly #feeds: ReadonlyMap<string, string>;
  readonly #endpoint: string;
  readonly #cacheMs: number;
  readonly #clock: Clock;
  readonly #fetchFn: typeof fetch;
  readonly #cache = new Map<string, Observation>();

  constructor(options: CoinbasePriceOracleOptions) {
    this.#feeds = new Map(Object.entries(options.feeds));
    this.#endpoint = options.endpoint ?? DEFAULT_COINBASE_ENDPOINT;
    this.#cacheMs = (options.cacheSeconds ?? DEFAULT_COINBASE_CACHE_SECONDS) * 1_000;
    this.#clock = options.clock ?? systemClock;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async reference(from: AssetCode, to: AssetCode): Promise<OraclePrice> {
    const product = this.#feeds.get(rateKey(from, to));
    if (product === undefined) {
      throw new ConfigurationError(`No Coinbase product configured for ${from} -> ${to}`, {
        from,
        to,
      });
    }

    const observation = await this.#observe(product, from, to);

    const scaledRate = scaleTickerPrice(observation.price, assetDecimals(to));
    if (scaledRate <= 0n) {
      throw new ProviderError(
        `Coinbase price for ${from} -> ${to} rounds to zero minor units of ${to}`,
        { from, to, product },
      );
    }

    return { from, to, scaledRate, source: "coinbase", observedAt: observation.observedAt };
  }

  async #observe(product: string, from: AssetCode, to: AssetCode): Promise<Observation> {
    const nowMs = this.#clock.now().getTime();
    const cached = this.#cache.get(product);
    if (cached !== undefined && nowMs < cached.expiresAtMs) {
      return cached;
    }

    const body = await this.#ticker(product, from, to);

    const observedAt = new Date(body.time);
    if (Number.isNaN(observedAt.getTime())) {
      throw new ProviderError(`Coinbase ticker for ${from} -> ${to} has an unreadable time`, {
        from,
        to,
        product,
        time: body.time,
      });
    }

    let price: DecimalPrice;
    try {
      price = splitDecimalPrice(body.price);
    } catch (error) {
      throw new ProviderError(
        `Coinbase price for ${from} -> ${to} is not a positive decimal`,
        { from, to, product, price: body.price },
        { cause: error },
      );
    }
    if (price.significand <= 0n) {
      throw new ProviderError(`Coinbase price for ${from} -> ${to} is not positive`, {
        from,
        to,
        product,
        price: body.price,
      });
    }

    const observation: Observation = { price, observedAt, expiresAtMs: nowMs + this.#cacheMs };
    this.#cache.set(product, observation);
    return observation;
  }

  async #ticker(product: string, from: AssetCode, to: AssetCode) {
    const url = `${this.#endpoint}/products/${encodeURIComponent(product)}/ticker`;

    let response: Response;
    try {
      // The public API rejects a request with no User-Agent, which is not
      // something a test double would ever reproduce.
      response = await this.#fetchFn(url, { headers: { "User-Agent": "mayarin" } });
    } catch (error) {
      throw new ProviderError(
        `Coinbase request for ${from} -> ${to} failed`,
        { from, to, product },
        { cause: error },
      );
    }

    if (!response.ok) {
      // A delisted or misspelled product is configuration, not a transient
      // fault — EURC-USD answers 404 "Not allowed for delisted products", and
      // retrying that forever would hide the misconfiguration behind a stall.
      const transient = response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `Coinbase responded ${response.status} for ${from} -> ${to}`,
        { from, to, product, status: response.status },
        { retryable: transient },
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new ProviderError(
        `Coinbase ticker for ${from} -> ${to} is not JSON`,
        { from, to, product },
        { cause: error },
      );
    }

    const parsed = coinbaseTickerSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(`Coinbase ticker for ${from} -> ${to} has an unexpected shape`, {
        from,
        to,
        product,
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }
    return parsed.data;
  }
}
