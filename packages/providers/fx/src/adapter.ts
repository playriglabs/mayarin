/**
 * FX rates price oracle adapter.
 *
 * Implements the `PriceOracle` port over an FX rates API, for the fiat leg the
 * quote engine cannot price any other way: `QuoteEngine` prices fiat ->
 * settlement through the oracle alone, because no swap venue quotes rupiah.
 *
 * **Why this exists beside the Pyth adapter.** Pyth Core's 2026-08-26 upgrade
 * put every Hermes feed behind an API key *and* behind a grant, and a default
 * key's grant is a per-feed allowlist of majors rather than a class of assets.
 * Measured against ours: `Crypto.ETH/USD`, `BTC`, `SOL`, `USDT`, `USDC` and
 * `FX.EUR/USD` answer 200, while `Crypto.SUI/USD`, `Crypto.ARB/USD`,
 * `Crypto.EURC/USD` and every `FX.USD/{IDR,SGD,THB,MYR}` answer
 * `403 Not entitled: no grant accepts this feed`. A denied Crypto feed and a
 * granted FX one sit side by side, so coverage cannot be reasoned about by
 * category — probe a feed against the deployment's own key before relying on
 * it. Losing the Asian FX feeds is what took every IDR- and SGD-priced payment
 * down. Compose them with
 * `FallbackPriceOracle`, which reads every source and drops the ones that
 * cannot serve a pair, so each oracle only needs the pairs it is configured
 * for.
 *
 * The `feeds` map is deployment configuration from pair to API symbol, and it
 * owns every equivalence: if a deployment backs `IDR/USDC` with the `USD/IDR`
 * series inverted, that is the deployment's stated judgement — that USDC holds
 * its dollar peg closely enough to price against — not something this adapter
 * infers. A missing pair is a `ConfigurationError`; no symmetry or cross-rate
 * derivation happens here, matching the other price seams.
 *
 * **One caveat the freshness guard cannot see.** The API stamps a response with
 * the time it served it, not the time the underlying market last traded, so
 * over a weekend it reports a minute-fresh timestamp on Friday's closing rate.
 * `QUOTE_FX_CLOSED_MAX_AGE_SECONDS` therefore never binds on this source. The
 * closed-market spread still applies: `QuoteEngine` decides that from the clock
 * (`isFxMarketOpen`), not from the observation's age.
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
  type DecimalRate,
  fxLatestResponseSchema,
  invertFxRate,
  scaleFxRate,
  splitDecimalRate,
} from "./rates.ts";

export const DEFAULT_FX_ENDPOINT = "https://api.fxratesapi.com";

/**
 * How long an observation is reused before the API is asked again.
 *
 * The oracle is on the hot path — every quote and every checkout preview of a
 * fiat-priced payment reads it — while the upstream series ticks about once a
 * minute. Caching keeps a free-tier quota out of the failure modes. It cannot
 * fake freshness: what is cached is the provider's own observation timestamp,
 * so a cached price ages exactly as the guard expects.
 */
export const DEFAULT_FX_CACHE_SECONDS = 60;

/**
 * A series for one pair.
 *
 * A bare string is the series quoted in the same direction as the pair. The
 * object form names a series quoted the other way round — the API publishes
 * rates against a base currency, so `IDR/USDC` can only be served by inverting
 * `USD/IDR`.
 *
 * Configuration rather than inference: the adapter deliberately infers no
 * symmetry, because an implicit inversion is the kind of thing that reads
 * correctly and is off by the square of the rate.
 */
export type FxFeed = string | { readonly symbol: string; readonly invert?: boolean };

export interface FxRatesPriceOracleOptions {
  /** Pair (`rateKey(from, to)`) to API symbol, e.g. `"IDR/USDC": { symbol: "USD/IDR", invert: true }`. */
  readonly feeds: Readonly<Record<string, FxFeed>>;
  readonly endpoint?: string;
  /** Sent as `Authorization: Bearer <key>`. Optional: the free tier is open. */
  readonly apiKey?: string;
  /** Observation reuse window; defaults to `DEFAULT_FX_CACHE_SECONDS`. */
  readonly cacheSeconds?: number;
  readonly clock?: Clock;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

interface Observation {
  readonly rate: DecimalRate;
  readonly observedAt: Date;
  /** When the reuse window closes, in epoch milliseconds. */
  readonly expiresAtMs: number;
}

export class FxRatesPriceOracle implements PriceOracle {
  readonly #feeds: ReadonlyMap<string, FxFeed>;
  readonly #endpoint: string;
  readonly #apiKey: string | undefined;
  readonly #cacheMs: number;
  readonly #clock: Clock;
  readonly #fetchFn: typeof fetch;
  readonly #cache = new Map<string, Observation>();
  /**
   * Every quote currency configured against each base.
   *
   * The API answers `currencies=SGD,IDR,THB,MYR` in one response, so a read for
   * any one of them fills the cache for all of them. Asking per symbol instead
   * spent one request per pair on a hot path shared by every fiat-priced quote,
   * and the free tier's 61-request window ran out — which surfaced as
   * "No fresh oracle price", the same message a dead feed produces.
   */
  readonly #quotesPerBase: ReadonlyMap<string, readonly string[]>;
  /**
   * When the API says it will accept requests again, in epoch milliseconds.
   *
   * A 429 is transient, so the taxonomy marks it retryable and the clearing
   * engine retries — but this provider counts a blocked request against the
   * window too, so retrying pushes the deadline further out. Measured: a probe
   * every 20s moved the reset from 14:48 to 15:07. Holding the deadline here
   * means a retry fails immediately, locally, and the ban expires on schedule.
   */
  #blockedUntilMs = 0;

  constructor(options: FxRatesPriceOracleOptions) {
    this.#feeds = new Map(Object.entries(options.feeds));
    this.#quotesPerBase = quotesPerBase(this.#feeds);
    this.#endpoint = options.endpoint ?? DEFAULT_FX_ENDPOINT;
    this.#apiKey = options.apiKey;
    this.#cacheMs = (options.cacheSeconds ?? DEFAULT_FX_CACHE_SECONDS) * 1_000;
    this.#clock = options.clock ?? systemClock;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async reference(from: AssetCode, to: AssetCode): Promise<OraclePrice> {
    const feed = this.#feeds.get(rateKey(from, to));
    if (feed === undefined) {
      throw new ConfigurationError(`No FX series configured for ${from} -> ${to}`, { from, to });
    }

    const symbol = typeof feed === "string" ? feed : feed.symbol;
    const invert = typeof feed === "string" ? false : feed.invert === true;
    const { base, quote } = splitSymbol(symbol, from, to);

    const observation = await this.#observe(symbol, base, quote, from, to);

    const scaledRate = invert
      ? invertFxRate(observation.rate, assetDecimals(to))
      : scaleFxRate(observation.rate, assetDecimals(to));
    if (scaledRate <= 0n) {
      throw new ProviderError(`FX rate for ${from} -> ${to} rounds to zero minor units of ${to}`, {
        from,
        to,
        symbol,
      });
    }

    return { from, to, scaledRate, source: "fx", observedAt: observation.observedAt };
  }

  async #observe(
    symbol: string,
    base: string,
    quote: string,
    from: AssetCode,
    to: AssetCode,
  ): Promise<Observation> {
    const nowMs = this.#clock.now().getTime();
    const cached = this.#cache.get(symbol);
    if (cached !== undefined && nowMs < cached.expiresAtMs) {
      return cached;
    }

    const body = await this.#latest(base, quote, from, to);

    // Every currency the response carries, not only the one that was asked
    // for: they share a timestamp and a request, and the next pair on this
    // base is about to want its own.
    const observedAt = new Date(body.timestamp * 1_000);
    const expiresAtMs = nowMs + this.#cacheMs;
    for (const [currency, value] of Object.entries(body.rates)) {
      if (value > 0) {
        this.#cache.set(`${base}/${currency}`, {
          rate: splitDecimalRate(value),
          observedAt,
          expiresAtMs,
        });
      }
    }

    const rate = body.rates[quote];
    if (rate === undefined) {
      throw new ProviderError(`FX response for ${from} -> ${to} does not contain ${quote}`, {
        from,
        to,
        symbol,
        currencies: Object.keys(body.rates),
      });
    }
    if (rate <= 0) {
      throw new ProviderError(`FX rate for ${from} -> ${to} is not positive`, {
        from,
        to,
        symbol,
        rate: rate.toString(),
      });
    }

    const observation: Observation = {
      rate: splitDecimalRate(rate),
      observedAt,
      expiresAtMs,
    };
    this.#cache.set(symbol, observation);
    return observation;
  }

  async #latest(base: string, quote: string, from: AssetCode, to: AssetCode) {
    const nowMs = this.#clock.now().getTime();
    // Refused here rather than at the API, so a retry does not renew the ban.
    if (nowMs < this.#blockedUntilMs) {
      throw new ProviderError(
        `FX API is rate limited for another ${Math.ceil((this.#blockedUntilMs - nowMs) / 1_000)}s`,
        { from, to, base, quote, retryAfter: new Date(this.#blockedUntilMs).toISOString() },
        { retryable: true },
      );
    }

    // The asked pair first, so a base with no configured feeds (a caller
    // holding this adapter directly) still resolves.
    const currencies = this.#quotesPerBase.get(base) ?? [quote];
    const url =
      `${this.#endpoint}/latest?base=${encodeURIComponent(base)}` +
      `&currencies=${encodeURIComponent(currencies.join(","))}`;
    const init: RequestInit = {};
    if (this.#apiKey !== undefined) {
      init.headers = { Authorization: `Bearer ${this.#apiKey}` };
    }

    let response: Response;
    try {
      response = await this.#fetchFn(url, init);
    } catch (error) {
      throw new ProviderError(
        `FX request for ${from} -> ${to} failed`,
        { from, to, base, quote },
        { cause: error },
      );
    }

    if (!response.ok) {
      if (response.status === 429) {
        this.#blockedUntilMs = retryAfterMs(response.headers.get("retry-after"), nowMs);
      }
      // 401/403/404 are auth/entitlement/config errors, not transient faults:
      // retrying them just loops forever, so mark them non-retryable and let
      // the clearing engine fail the payment instead of hammering the API.
      const transient = response.status === 429 || response.status >= 500;
      throw new ProviderError(
        `FX API responded ${response.status} for ${from} -> ${to}`,
        { from, to, base, quote, status: response.status },
        { retryable: transient },
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new ProviderError(
        `FX response for ${from} -> ${to} is not JSON`,
        { from, to, base, quote },
        { cause: error },
      );
    }

    const parsed = fxLatestResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(`FX response for ${from} -> ${to} has an unexpected shape`, {
        from,
        to,
        base,
        quote,
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }
    return parsed.data;
  }
}

/** `"USD/IDR"` is the base currency, then the quote currency. */
function splitSymbol(symbol: string, from: AssetCode, to: AssetCode) {
  const [base, quote, ...rest] = symbol.split("/");
  if (base === undefined || quote === undefined || rest.length > 0) {
    throw new ConfigurationError(
      `The FX series for ${from} -> ${to} must read "BASE/QUOTE", not "${symbol}"`,
      { from, to, symbol },
    );
  }
  return { base, quote };
}

/**
 * Which quote currencies each base needs, across every configured feed.
 *
 * One response per base rather than one per pair. A deployment pricing four
 * currencies into two settlement assets configures eight feeds over two bases,
 * and this turns eight requests into two.
 */
function quotesPerBase(feeds: ReadonlyMap<string, FxFeed>): ReadonlyMap<string, readonly string[]> {
  const bases = new Map<string, Set<string>>();
  for (const feed of feeds.values()) {
    const symbol = typeof feed === "string" ? feed : feed.symbol;
    const [base, quote, ...rest] = symbol.split("/");
    // A malformed symbol is reported by `splitSymbol` when that pair is asked
    // for, naming the pair. Skipping it here keeps one bad entry from
    // poisoning the batch for every other pair on the same base.
    if (base === undefined || quote === undefined || rest.length > 0) continue;
    const quotes = bases.get(base) ?? new Set<string>();
    quotes.add(quote);
    bases.set(base, quotes);
  }
  return new Map([...bases].map(([base, quotes]) => [base, [...quotes]]));
}

/** A minute, when the API rate limits without saying for how long. */
const DEFAULT_RETRY_AFTER_MS = 60_000;

/**
 * When to try again, from a `retry-after` header.
 *
 * The standard header is a delta in seconds or an HTTP date; fxratesapi sends
 * an epoch in milliseconds. All three are accepted, and anything else falls
 * back to a minute — a wrong-but-bounded wait beats retrying into the ban.
 */
function retryAfterMs(header: string | null, nowMs: number): number {
  if (header === null) return nowMs + DEFAULT_RETRY_AFTER_MS;

  const numeric = Number(header);
  if (Number.isFinite(numeric)) {
    // Epoch milliseconds if it lands in the future as an absolute instant;
    // a delta in seconds otherwise. No real delta is 1e12 seconds.
    const asInstant = numeric > nowMs ? numeric : nowMs + numeric * 1_000;
    return Math.min(asInstant, nowMs + 3_600_000);
  }

  const date = Date.parse(header);
  return Number.isNaN(date) ? nowMs + DEFAULT_RETRY_AFTER_MS : date;
}
