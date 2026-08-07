/**
 * Pyth price oracle adapter (RFC #7).
 *
 * Implements the `PriceOracle` port over Hermes, Pyth's pull-based price
 * service. This is the *off-chain reference read* the quote-time deviation
 * guard consumes; posting the signed update on-chain for settlement-time
 * verification is the execution layer's job (RFC #4/#5) and deliberately not
 * done here.
 *
 * The `feeds` map is deployment configuration from pair to feed id, and it
 * owns every equivalence: if a deployment backs `ETH/USDC` with Pyth's
 * `ETH/USD` feed, that is the deployment's stated judgement, not something
 * this adapter infers. A missing pair is a `ConfigurationError`; no symmetry
 * or cross-rate derivation happens here, matching the other price seams.
 */

import type { OraclePrice, PriceOracle } from "@mayarin/clearing";
import { rateKey } from "@mayarin/clearing";
import { type AssetCode, assetDecimals, ConfigurationError, ProviderError } from "@mayarin/shared";
import {
  hermesLatestResponseSchema,
  invertPythPrice,
  normalizeFeedId,
  scalePythPrice,
} from "./hermes.ts";

export const DEFAULT_HERMES_ENDPOINT = "https://hermes.pyth.network";

/**
 * A feed for one pair.
 *
 * A bare string is the feed quoted in the same direction as the pair. The
 * object form names a feed quoted the other way round — Pyth publishes
 * `FX.USD/IDR` and no reverse, so `IDR/USDC` can only be served by inverting it.
 *
 * Configuration rather than inference: the adapter deliberately infers no
 * symmetry, because an implicit inversion is the kind of thing that reads
 * correctly and is off by the square of the rate.
 */
export type PythFeed = string | { readonly id: string; readonly invert?: boolean };

export interface PythPriceOracleOptions {
  /** Pair (`rateKey(from, to)`) to Hermes feed, e.g. `"ETH/USDC": "ff61…"`. */
  readonly feeds: Readonly<Record<string, PythFeed>>;
  readonly endpoint?: string;
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
}

export class PythPriceOracle implements PriceOracle {
  readonly #feeds: ReadonlyMap<string, PythFeed>;
  readonly #endpoint: string;
  readonly #fetchFn: typeof fetch;

  constructor(options: PythPriceOracleOptions) {
    this.#feeds = new Map(Object.entries(options.feeds));
    this.#endpoint = options.endpoint ?? DEFAULT_HERMES_ENDPOINT;
    this.#fetchFn = options.fetchFn ?? fetch;
  }

  async reference(from: AssetCode, to: AssetCode): Promise<OraclePrice> {
    const feed = this.#feeds.get(rateKey(from, to));
    if (feed === undefined) {
      throw new ConfigurationError(`No Pyth feed configured for ${from} -> ${to}`, { from, to });
    }

    const feedId = typeof feed === "string" ? feed : feed.id;
    const invert = typeof feed === "string" ? false : feed.invert === true;

    const body = await this.#latest(feedId, from, to);
    const wanted = normalizeFeedId(feedId);
    const entry = body.parsed.find((candidate) => normalizeFeedId(candidate.id) === wanted);
    if (entry === undefined) {
      throw new ProviderError(
        `Hermes response for ${from} -> ${to} does not contain feed ${feedId}`,
        { from, to, feedId },
      );
    }

    const significand = BigInt(entry.price.price);
    if (significand <= 0n) {
      throw new ProviderError(`Pyth price for ${from} -> ${to} is not positive`, {
        from,
        to,
        feedId,
        price: entry.price.price,
        expo: entry.price.expo,
      });
    }

    const scaledRate = invert
      ? invertPythPrice(significand, entry.price.expo, assetDecimals(to))
      : scalePythPrice(significand, entry.price.expo, assetDecimals(to));
    if (scaledRate <= 0n) {
      throw new ProviderError(
        `Pyth price for ${from} -> ${to} rounds to zero minor units of ${to}`,
        { from, to, feedId, price: entry.price.price, expo: entry.price.expo },
      );
    }

    return {
      from,
      to,
      scaledRate,
      source: "pyth",
      observedAt: new Date(entry.price.publish_time * 1_000),
    };
  }

  async #latest(feedId: string, from: AssetCode, to: AssetCode) {
    const url = `${this.#endpoint}/v2/updates/price/latest?ids[]=${encodeURIComponent(feedId)}`;

    let response: Response;
    try {
      response = await this.#fetchFn(url);
    } catch (error) {
      throw new ProviderError(
        `Hermes request for ${from} -> ${to} failed`,
        { from, to, feedId },
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new ProviderError(`Hermes responded ${response.status} for ${from} -> ${to}`, {
        from,
        to,
        feedId,
        status: response.status,
      });
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      throw new ProviderError(
        `Hermes response for ${from} -> ${to} is not JSON`,
        { from, to, feedId },
        { cause: error },
      );
    }

    const parsed = hermesLatestResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new ProviderError(`Hermes response for ${from} -> ${to} has an unexpected shape`, {
        from,
        to,
        feedId,
        issues: parsed.error.issues.map((issue) => issue.message),
      });
    }
    return parsed.data;
  }
}
