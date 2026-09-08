/**
 * Which rail to pay on, given what the rails have actually been doing.
 *
 * A resource priced on several chains has to be paid on exactly one of them,
 * and the choice is not arbitrary: an order settles against a deadline, so the
 * rail that has been settling with seconds to spare is the rail one network
 * hiccup away from an `ExpiredOrder` revert. Headroom — the seconds an order
 * had left when it landed — is the number that says so, and it is what the
 * subgraph keeps per settlement.
 *
 * Pure on purpose. The observations come from wherever the caller reads them,
 * so the rule can be tested exhaustively without a subgraph, and changing the
 * rule cannot become a redeployment.
 *
 * **The choice ranks on headroom, and reports failures without ranking on
 * them.** A failure count cannot come from the chain — a reverted payment
 * leaves no log, and an authorization nobody broadcast leaves no transaction —
 * so it is only ever as complete as Mayarin's own records happen to be. Ranking
 * on it would make the rail depend on how well we were recording rather than on
 * how the rail behaved, and `undefined` would quietly become zero.
 */

import type { ChainId } from "@mayarin/chain";
import { ValidationError } from "@mayarin/shared";

/** What one rail has been observed doing. */
export interface RailObservation {
  readonly chain: ChainId;
  /** `headroomSeconds` per settled payment. Order does not matter. */
  readonly headroomSeconds: readonly number[];
  /**
   * Failures Mayarin recorded for this rail.
   *
   * Optional, and `undefined` means *not known* rather than none: the chain
   * cannot supply this number, so a caller that has not looked must be able to
   * say so.
   */
  readonly failures?: number;
}

/**
 * Where observations come from.
 *
 * A port because the answer is read from somewhere concrete — a subgraph today
 * — and because the rule above must stay testable without one.
 *
 * It throws rather than omitting a rail it could not reach: a rail that failed
 * to answer and a rail that has never settled are different things, and only
 * the caller can decide what to do about the first. `chooseRail` treats an
 * omitted rail as unobserved, which would quietly turn an outage into a
 * confident-looking choice.
 */
export interface RailObservationSource {
  observe(chains: readonly ChainId[]): Promise<readonly RailObservation[]>;
}

export interface ChooseRailOptions {
  /**
   * Settlements a rail needs before its median means anything.
   *
   * Below it the rail is not ranked at all. One lucky settlement with 300
   * seconds of headroom is not evidence, and treating it as evidence is how a
   * demo picks a rail that has never carried load.
   */
  readonly minSamples: number;
}

const DEFAULT_OPTIONS: ChooseRailOptions = { minSamples: 5 };

export interface RailChoice {
  readonly chain: ChainId;
  /** One line, ready to print: why this rail, in the terms it was chosen on. */
  readonly reason: string;
  /** Absent when nothing about this rail was observed. */
  readonly medianHeadroomSeconds?: number;
  readonly samples: number;
  /** As reported. Absent means nobody looked, not none. */
  readonly failures?: number;
  /**
   * True when no rail had enough observations and the first accepted rail was
   * taken. The caller is expected to say this out loud rather than present a
   * fallback as a decision.
   */
  readonly unobserved: boolean;
}

/**
 * Pick a rail from the ones a resource accepts.
 *
 * Ranked by median headroom, then by sample count, then by the order the
 * resource listed them — every tie-break is deterministic, because a choice
 * that moves between two identical inputs cannot be explained to anyone.
 */
export function chooseRail(
  accepted: readonly ChainId[],
  observations: readonly RailObservation[],
  options: Partial<ChooseRailOptions> = {},
): RailChoice {
  const first = accepted[0];
  if (first === undefined) {
    throw new ValidationError("chooseRail needs at least one accepted rail", {});
  }

  const { minSamples } = { ...DEFAULT_OPTIONS, ...options };

  const ranked = accepted
    .map((chain, position) => ({
      chain,
      position,
      observation: observationOf(observations, chain),
    }))
    .flatMap((candidate) => {
      const samples = candidate.observation?.headroomSeconds ?? [];
      if (samples.length < minSamples) return [];
      return [{ ...candidate, samples, median: medianOf(samples) }];
    })
    .sort(byHeadroom);

  const best = ranked[0];
  if (best === undefined) {
    return {
      chain: first,
      reason: `${first}: no rail has ${minSamples} observed settlements, so this is the first accepted rail rather than a choice`,
      samples: observationOf(observations, first)?.headroomSeconds.length ?? 0,
      ...failuresOf(observations, first),
      unobserved: true,
    };
  }

  const failures = best.observation?.failures;
  return {
    chain: best.chain,
    reason: `${best.chain}: median headroom ${format(best.median)}s over ${best.samples.length} settlements, ${describeFailures(failures)}`,
    medianHeadroomSeconds: best.median,
    samples: best.samples.length,
    ...(failures === undefined ? {} : { failures }),
    unobserved: false,
  };
}

/**
 * What one rail has been doing, as a number a caller can show somebody.
 *
 * `chooseRail` answers *which* rail and reports only the winner's median. This
 * answers *what the rails look like*, for every rail asked about, which is the
 * question an agent deciding for itself has — and the question the paid MCP
 * tool sells.
 *
 * **The minimum is here because the median hides it.** Base Sepolia's median
 * headroom is 828 seconds and its worst settlement landed with 28, and a rail
 * whose tail brushes the deadline is the one about to start reverting on
 * `ExpiredOrder`. A summary that reported only the middle would describe that
 * rail as comfortable.
 */
export interface RailSummary {
  readonly chain: ChainId;
  readonly samples: number;
  /** Absent when the rail has no observed settlements at all. */
  readonly medianHeadroomSeconds?: number;
  /** The worst settlement observed — the one the median hides. */
  readonly minHeadroomSeconds?: number;
  readonly maxHeadroomSeconds?: number;
  /** As reported. Absent means nobody looked, not none. */
  readonly failures?: number;
}

/**
 * Summarise every rail asked about, observed or not.
 *
 * A chain with no observation comes back with zero samples rather than being
 * dropped. Omitting it would make "we have never seen this rail settle" and "we
 * did not ask about this rail" the same answer, and they are not.
 */
export function summariseRails(
  chains: readonly ChainId[],
  observations: readonly RailObservation[],
): readonly RailSummary[] {
  return chains.map((chain) => {
    const observation = observationOf(observations, chain);
    const samples = observation?.headroomSeconds ?? [];
    const failures = observation?.failures;

    if (samples.length === 0) {
      return { chain, samples: 0, ...(failures === undefined ? {} : { failures }) };
    }

    const sorted = [...samples].sort((left, right) => left - right);
    return {
      chain,
      samples: samples.length,
      medianHeadroomSeconds: medianOf(samples),
      minHeadroomSeconds: sorted[0] ?? 0,
      maxHeadroomSeconds: sorted[sorted.length - 1] ?? 0,
      ...(failures === undefined ? {} : { failures }),
    };
  });
}

/**
 * What one rail looks like to a payer holding a list of them (#260).
 *
 * `healthy` and `degraded` both require `minSamples` observed settlements;
 * below that a rail is `unobserved`, which is a statement about Mayarin's
 * records, not about the rail. A new chain is not a bad chain.
 */
export type RailStanding = "healthy" | "degraded" | "unobserved";

/** One rail, placed in a payer's list, with what the observations said about it. */
export interface RankedRail<T extends { readonly chain: ChainId }> {
  readonly rail: T;
  readonly standing: RailStanding;
}

export interface RankRailsOptions extends ChooseRailOptions {
  /**
   * Median headroom below this many seconds marks a rail `degraded`.
   *
   * The same line `chooseRail`'s doc draws — a rail settling with seconds to
   * spare is one network hiccup away from an `ExpiredOrder` revert — held
   * still long enough to tell a payer which of their options it is.
   */
  readonly degradedBelowSeconds?: number;
}

const DEFAULT_DEGRADED_BELOW_SECONDS = 30;

/**
 * Rank every rail a payer is offered, rather than pick one.
 *
 * The same evidence `chooseRail` ranks on — median headroom, the same
 * minimum-sample rule — applied to a list. Rails order `healthy`, then
 * `unobserved`, then `degraded`; within `healthy` and `degraded` the
 * `chooseRail` comparator applies (median, then samples, then catalog
 * position), and `unobserved` keeps catalog order, because a rail Mayarin
 * has not measured has no rank to keep.
 *
 * Generic over the rail so this stays in `@mayarin/x402` without a sideways
 * dependency on the package that defines `OfferedRail` — anything carrying a
 * `ChainId` can be ranked.
 *
 * **Failures are carried in the observations and ignored here**, exactly as
 * `chooseRail` ignores them: a failure count reflects how well Mayarin
 * recorded, not how the rail behaved.
 */
export function rankRails<T extends { readonly chain: ChainId }>(
  rails: readonly T[],
  observations: readonly RailObservation[],
  options: Partial<RankRailsOptions> = {},
): readonly RankedRail<T>[] {
  const { minSamples, degradedBelowSeconds } = {
    ...DEFAULT_OPTIONS,
    degradedBelowSeconds: DEFAULT_DEGRADED_BELOW_SECONDS,
    ...options,
  };

  const healthy: { rail: T; median: number; samples: readonly number[]; position: number }[] = [];
  const degraded: typeof healthy = [];
  const unobserved: RankedRail<T>[] = [];

  for (const [position, rail] of rails.entries()) {
    const samples = observationOf(observations, rail.chain)?.headroomSeconds ?? [];
    if (samples.length < minSamples) {
      unobserved.push({ rail, standing: "unobserved" });
      continue;
    }
    const entry = { rail, median: medianOf(samples), samples, position };
    if (entry.median < degradedBelowSeconds) degraded.push(entry);
    else healthy.push(entry);
  }

  return [
    ...healthy.sort(byHeadroom).map(({ rail }) => ({ rail, standing: "healthy" as const })),
    ...unobserved,
    ...degraded.sort(byHeadroom).map(({ rail }) => ({ rail, standing: "degraded" as const })),
  ];
}

/**
 * The one ranking rule `chooseRail` and `rankRails` both sort on: median
 * headroom, then sample count, then the order the caller listed them. Every
 * tie-break is deterministic, because an order that moves between two
 * identical inputs cannot be explained to anyone.
 */
function byHeadroom(
  left: { readonly median: number; readonly samples: readonly number[]; readonly position: number },
  right: {
    readonly median: number;
    readonly samples: readonly number[];
    readonly position: number;
  },
): number {
  return (
    right.median - left.median ||
    right.samples.length - left.samples.length ||
    left.position - right.position
  );
}

function observationOf(
  observations: readonly RailObservation[],
  chain: ChainId,
): RailObservation | undefined {
  return observations.find((observation) => observation.chain === chain);
}

function failuresOf(
  observations: readonly RailObservation[],
  chain: ChainId,
): { failures?: number } {
  const failures = observationOf(observations, chain)?.failures;
  return failures === undefined ? {} : { failures };
}

function describeFailures(failures: number | undefined): string {
  if (failures === undefined) return "failures not recorded";
  return failures === 0 ? "no recorded failures" : `${failures} recorded failure(s)`;
}

/**
 * The middle sample, or the mean of the middle two.
 *
 * A median rather than a mean because one settlement that sat in a queue for a
 * minute should not make a rail look generous, and a mean lets it.
 */
function medianOf(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) {
    throw new ValidationError("medianOf needs at least one sample", {});
  }
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

/** Whole seconds read better than `58.5`, and the halves carry no meaning. */
function format(seconds: number): string {
  return Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(1);
}
