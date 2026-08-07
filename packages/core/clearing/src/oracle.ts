/**
 * Price oracle port and deviation guard (RFC #7).
 *
 * The oracle is a data dependency, not a fill source: the executable price the
 * merchant's `minOut` is derived from always comes from the venue (a DEX or
 * aggregator `PriceSource`); the oracle supplies an independent reference the
 * executable price is checked against. Trust the DEX for the fill, guard with
 * the oracle — a stale or manipulated venue price fails the guard instead of
 * producing a bad lock.
 *
 * The port lives in core beside `RateProvider` and `PriceSource`; adapters that
 * need the network (Pyth's pull feed, a Chainlink read through viem) live in
 * `packages/providers/*` and implement `PriceOracle`, keeping the network
 * boundary out of core. The guard itself is pure: prices in, verdict out, time
 * injected by the caller.
 */

import { type AssetCode, ConfigurationError, ProviderError } from "@mayarin/shared";

/** A reference price observation from an oracle. */
export interface OraclePrice {
  readonly from: AssetCode;
  readonly to: AssetCode;
  /** Minor units of `to` per one whole unit of `from`. */
  readonly scaledRate: bigint;
  readonly source: string;
  /** When the oracle observed the price — publish time, not fetch time. */
  readonly observedAt: Date;
}

/** Price oracle port: the seam Pyth/Chainlink adapters implement. */
export interface PriceOracle {
  /** Reference price for the pair, or throw if this oracle cannot serve it. */
  reference(from: AssetCode, to: AssetCode): Promise<OraclePrice>;
}

/**
 * The executable price under guard — the shape `RateQuote` and `PriceQuote`
 * already share, so either can be checked without conversion.
 */
export interface ExecutablePrice {
  readonly from: AssetCode;
  readonly to: AssetCode;
  /** Minor units of `to` per one whole unit of `from`. */
  readonly scaledRate: bigint;
  readonly source: string;
}

export interface DeviationPolicy {
  /** Widest tolerated gap between executable and reference, in basis points. */
  readonly maxDeviationBps: number;
  /** Oldest tolerated reference observation, in milliseconds. */
  readonly maxAgeMs: number;
}

/**
 * Rejects a reference price older than `maxAgeMs` at `now`.
 *
 * Staleness is a provider condition, not a caller mistake, so the failure is a
 * retryable `ProviderError` — the quote engine leaves the payment where it is
 * and a later attempt sees a fresher observation. A future-dated observation
 * (clock skew between the oracle and this process) counts as fresh.
 */
export function assertFresh(reference: OraclePrice, maxAgeMs: number, now: Date): void {
  const ageMs = now.getTime() - reference.observedAt.getTime();
  if (ageMs > maxAgeMs) {
    throw new ProviderError(
      `Oracle price for ${reference.from} -> ${reference.to} is stale: observed ${ageMs}ms ago, limit ${maxAgeMs}ms`,
      {
        from: reference.from,
        to: reference.to,
        source: reference.source,
        ageMs,
        maxAgeMs,
      },
    );
  }
}

/**
 * Rejects an executable price that deviates from the reference by more than
 * `maxDeviationBps` in either direction.
 *
 * The comparison is exact integer arithmetic with no division:
 * `|executable − reference| * 10_000 > maxDeviationBps * reference`, so a
 * deviation of exactly `maxDeviationBps` passes and nothing is lost to
 * rounding. A mismatched pair or a non-positive reference rate is a wiring
 * bug, not a market condition, and throws `ConfigurationError`.
 */
export function assertWithinDeviation(
  executable: ExecutablePrice,
  reference: OraclePrice,
  maxDeviationBps: number,
): void {
  if (executable.from !== reference.from || executable.to !== reference.to) {
    throw new ConfigurationError(
      `Deviation guard pair mismatch: executable ${executable.from} -> ${executable.to}, reference ${reference.from} -> ${reference.to}`,
      {
        executableFrom: executable.from,
        executableTo: executable.to,
        referenceFrom: reference.from,
        referenceTo: reference.to,
      },
    );
  }
  if (reference.scaledRate <= 0n) {
    throw new ConfigurationError(
      `Oracle reference rate for ${reference.from} -> ${reference.to} is not positive`,
      { from: reference.from, to: reference.to, source: reference.source },
    );
  }

  const executableRate = executable.scaledRate;
  const referenceRate = reference.scaledRate;
  const difference =
    executableRate >= referenceRate
      ? executableRate - referenceRate
      : referenceRate - executableRate;

  if (difference * 10_000n > BigInt(maxDeviationBps) * referenceRate) {
    // Informational only — the rejection above is exact; this floor-divided
    // figure just makes the error message readable.
    const deviationBps = (difference * 10_000n) / referenceRate;
    throw new ProviderError(
      `Executable price for ${executable.from} -> ${executable.to} deviates ${deviationBps} bps from ${reference.source}, limit ${maxDeviationBps} bps`,
      {
        from: executable.from,
        to: executable.to,
        executableSource: executable.source,
        referenceSource: reference.source,
        executableRate: executableRate.toString(),
        referenceRate: referenceRate.toString(),
        deviationBps: deviationBps.toString(),
        maxDeviationBps,
      },
    );
  }
}

/**
 * The full guard the quote engine runs before locking a price: freshness
 * first — a stale reference makes the deviation comparison meaningless — then
 * deviation.
 */
export function guardExecutablePrice(
  executable: ExecutablePrice,
  reference: OraclePrice,
  policy: DeviationPolicy,
  now: Date,
): void {
  assertFresh(reference, policy.maxAgeMs, now);
  assertWithinDeviation(executable, reference, policy.maxDeviationBps);
}
