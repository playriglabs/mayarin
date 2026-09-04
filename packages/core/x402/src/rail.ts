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
    .sort(
      (left, right) =>
        right.median - left.median ||
        right.samples.length - left.samples.length ||
        left.position - right.position,
    );

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
