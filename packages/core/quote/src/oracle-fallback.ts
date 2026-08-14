/**
 * Freshness-aware oracle failover.
 *
 * Every configured source is read concurrently. Failed and stale observations
 * are removed, the remaining sources must agree, and the first configured
 * source wins. This keeps provider priority explicit while ensuring a healthy
 * secondary can carry a quote when the primary stops publishing.
 */

import type { OraclePrice, PriceOracle } from "@mayarin/clearing";
import { type AssetCode, type Clock, ConfigurationError, ProviderError } from "@mayarin/shared";

export interface OracleSource {
  readonly name: string;
  readonly oracle: PriceOracle;
}

export interface FallbackPriceOracleOptions {
  readonly sources: readonly OracleSource[];
  readonly clock: Clock;
  readonly maxAgeMs: (from: AssetCode, to: AssetCode, now: Date) => number;
  readonly maxDeviationBps: number;
}

interface Observation {
  readonly source: OracleSource;
  readonly price: OraclePrice;
}

export class FallbackPriceOracle implements PriceOracle {
  readonly #sources: readonly OracleSource[];
  readonly #clock: Clock;
  readonly #maxAgeMs: FallbackPriceOracleOptions["maxAgeMs"];
  readonly #maxDeviationBps: number;

  constructor(options: FallbackPriceOracleOptions) {
    if (options.sources.length === 0) {
      throw new ConfigurationError("A fallback oracle needs at least one source", {});
    }
    this.#sources = options.sources;
    this.#clock = options.clock;
    this.#maxAgeMs = options.maxAgeMs;
    this.#maxDeviationBps = options.maxDeviationBps;
  }

  async reference(from: AssetCode, to: AssetCode): Promise<OraclePrice> {
    const now = this.#clock.now();
    const maxAgeMs = this.#maxAgeMs(from, to, now);
    const settled = await Promise.allSettled(
      this.#sources.map(
        async (source): Promise<Observation> => ({
          source,
          price: await source.oracle.reference(from, to),
        }),
      ),
    );

    const observations = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const fresh = observations.filter(({ price }) => isFresh(price, maxAgeMs, now));

    if (fresh.length === 0) {
      throw new ProviderError(
        `No fresh oracle price is available for ${from} -> ${to}`,
        {
          from,
          to,
          maxAgeMs,
          sources: this.#sources.map((source, index) => ({
            source: source.name,
            result: describeResult(settled[index], now),
          })),
        },
        { retryable: true },
      );
    }

    const selected = fresh[0];
    if (selected === undefined) {
      throw new ConfigurationError("Fresh oracle selection produced no result", { from, to });
    }

    for (const candidate of fresh.slice(1)) {
      assertReferencesAgree(selected.price, candidate.price, this.#maxDeviationBps);
    }

    return selected.price;
  }
}

function isFresh(price: OraclePrice, maxAgeMs: number, now: Date): boolean {
  return now.getTime() - price.observedAt.getTime() <= maxAgeMs;
}

function describeResult(
  result: PromiseSettledResult<Observation> | undefined,
  now: Date,
): Readonly<Record<string, unknown>> {
  if (result === undefined) return { status: "missing" };
  if (result.status === "rejected") {
    return {
      status: "failed",
      reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  }
  return {
    status: "observed",
    observedAt: result.value.price.observedAt.toISOString(),
    ageMs: Math.max(0, now.getTime() - result.value.price.observedAt.getTime()),
  };
}

function assertReferencesAgree(
  selected: OraclePrice,
  candidate: OraclePrice,
  maxDeviationBps: number,
): void {
  if (selected.from !== candidate.from || selected.to !== candidate.to) {
    throw new ConfigurationError("Fallback oracle returned a mismatched pair", {
      selected: `${selected.from}/${selected.to}`,
      candidate: `${candidate.from}/${candidate.to}`,
      candidateSource: candidate.source,
    });
  }
  if (selected.scaledRate <= 0n || candidate.scaledRate <= 0n) {
    throw new ConfigurationError("Fallback oracle returned a non-positive rate", {
      selectedSource: selected.source,
      candidateSource: candidate.source,
    });
  }

  const difference =
    selected.scaledRate >= candidate.scaledRate
      ? selected.scaledRate - candidate.scaledRate
      : candidate.scaledRate - selected.scaledRate;
  const baseline =
    selected.scaledRate <= candidate.scaledRate ? selected.scaledRate : candidate.scaledRate;

  if (difference * 10_000n > BigInt(maxDeviationBps) * baseline) {
    const deviationBps = (difference * 10_000n) / baseline;
    throw new ProviderError(
      `Oracle sources disagree ${deviationBps} bps for ${selected.from} -> ${selected.to}, limit ${maxDeviationBps} bps`,
      {
        from: selected.from,
        to: selected.to,
        selectedSource: selected.source,
        selectedRate: selected.scaledRate.toString(),
        candidateSource: candidate.source,
        candidateRate: candidate.scaledRate.toString(),
        deviationBps: deviationBps.toString(),
        maxDeviationBps,
      },
      { retryable: true },
    );
  }
}
