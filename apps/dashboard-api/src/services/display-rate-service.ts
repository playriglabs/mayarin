/**
 * Exchange rates for showing a balance in the merchant's own currency.
 *
 * Display only. Nothing is priced, locked or settled with these, and the payment
 * API keeps its own rate sources for that, so a merchant opening the dashboard
 * can never use up the budget a checkout needs.
 *
 * One daily-updated table (open.er-api.com, no key) is fetched at most once per
 * `ttlSeconds` per process and shared by every merchant. A failed fetch keeps
 * serving the last table and is not retried for a few minutes.
 */

import { type Clock, ValidationError } from "@mayarin/shared";

/** Units of each currency that one US dollar buys, as decimal strings. */
export type DisplayRates = Readonly<Record<string, string>>;

const RETRY_AFTER_FAILURE_MS = 5 * 60_000;

export interface DisplayRateServiceOptions {
  readonly url: string;
  readonly ttlSeconds: number;
  readonly clock: Clock;
  /** Overridable so a test never reaches the network. */
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export class DisplayRateService {
  readonly #url: string;
  readonly #ttlMs: number;
  readonly #clock: Clock;
  readonly #fetch: (url: string, init?: RequestInit) => Promise<Response>;
  #rates: DisplayRates | undefined;
  #fetchedAtMs = 0;
  #retryAtMs = 0;
  #inflight: Promise<void> | undefined;

  constructor(options: DisplayRateServiceOptions) {
    this.#url = options.url;
    this.#ttlMs = options.ttlSeconds * 1_000;
    this.#clock = options.clock;
    this.#fetch = options.fetch ?? fetch;
  }

  /** The current table, or `undefined` if none has ever been read. */
  async rates(): Promise<DisplayRates | undefined> {
    const now = this.#clock.now().getTime();
    const stale = this.#rates === undefined || now - this.#fetchedAtMs >= this.#ttlMs;
    if (stale && now >= this.#retryAtMs) {
      this.#inflight ??= this.#refresh(now).finally(() => {
        this.#inflight = undefined;
      });
      await this.#inflight;
    }
    return this.#rates;
  }

  /** What one US dollar buys in `currency`, or `undefined` if it has no rate. */
  async perUsd(currency: string): Promise<string | undefined> {
    return (await this.rates())?.[currency];
  }

  /**
   * Refuses a currency the table does not quote. With no table to check against
   * (the source is down) a well-formed code passes, so signup never waits on it.
   */
  async assertKnown(currency: string): Promise<void> {
    const rates = await this.rates();
    if (rates !== undefined && rates[currency] === undefined) {
      throw new ValidationError(`"${currency}" is not a currency we can show money in`, {
        currency,
      });
    }
  }

  async #refresh(now: number): Promise<void> {
    try {
      const response = await this.#fetch(this.#url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`status ${response.status}`);
      this.#rates = parseRates(await response.json());
      this.#fetchedAtMs = now;
    } catch {
      this.#retryAtMs = now + RETRY_AFTER_FAILURE_MS;
    }
  }
}

function parseRates(body: unknown): DisplayRates {
  const rates = (body as { rates?: Record<string, unknown> } | null)?.rates;
  if (rates === undefined || typeof rates !== "object") throw new Error("no rates in response");
  const out: Record<string, string> = {};
  for (const [code, value] of Object.entries(rates)) {
    if (
      /^[A-Z]{3}$/.test(code) &&
      typeof value === "number" &&
      value > 0 &&
      Number.isFinite(value)
    ) {
      out[code] = value.toFixed(8);
    }
  }
  if (out.USD === undefined) throw new Error("rates are not quoted against USD");
  return out;
}
