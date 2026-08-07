/**
 * Venue selection (RFC #5 — #48).
 *
 * The selector asks the configured venues for an executable quote and picks
 * one. The strategy decides how. An `immediate` (POS) payment cannot wait,
 * so the first executable quote wins. A `batched` payment tolerates latency,
 * so the selector waits for all venues and the best `minOut` wins.
 *
 * One venue failure does not fail the selection — the selector continues
 * with the other venues. If every venue fails, the selector throws a
 * retryable `ProviderError` that names each venue and its reason.
 *
 * The MEV exposure policy is recorded per strategy and travels with the
 * selection, so the submission layer knows where the transaction can go.
 * Private-mempool submission itself is deployment configuration, not code
 * in this package.
 */

import type { PriceQuote } from "@mayarin/clearing";
import {
  type AssetCode,
  ConfigurationError,
  type Money,
  ProviderError,
  ValidationError,
} from "@mayarin/shared";
import type { SwapVenue } from "./venue.ts";

/** How urgently the payment needs execution: POS checkout against batch settlement. */
export type ExecutionStrategy = "immediate" | "batched";

/** Where the transaction is visible before inclusion in a block. */
export type MevExposure = "public-mempool" | "private-mempool";

/** The selection behaviour and the MEV exposure for one strategy. */
export interface StrategyPolicy {
  /**
   * `first-quote` takes the first venue that answers, for a low latency
   * tolerance. `best-quote` waits for every venue and takes the best
   * `minOut`, for a high latency tolerance.
   */
  readonly wait: "first-quote" | "best-quote";
  readonly mev: MevExposure;
}

export type StrategyPolicies = Readonly<Record<ExecutionStrategy, StrategyPolicy>>;

/**
 * The default MEV/latency tradeoff (RFC #5 open question). An immediate POS
 * payment cannot absorb private-mempool latency, so it races the venues and
 * stays public. A batched payment can wait, so it takes the best price and
 * goes private. A deployment overrides this table in configuration.
 */
export const DEFAULT_STRATEGY_POLICIES: StrategyPolicies = {
  immediate: { wait: "first-quote", mev: "public-mempool" },
  batched: { wait: "best-quote", mev: "private-mempool" },
};

/** The chosen venue, its quote, and the policy the submission layer must apply. */
export interface VenueSelection {
  readonly venue: SwapVenue;
  readonly quote: PriceQuote;
  readonly strategy: ExecutionStrategy;
  readonly mev: MevExposure;
}

interface Candidate {
  readonly venue: SwapVenue;
  readonly quote: PriceQuote;
}

/**
 * Selects a venue for `amount` of `payerAsset` into `settlementAsset`.
 *
 * Selection is cross-asset only — the planner owns the same-asset no-swap
 * decision. Selection is deterministic for equal quotes: the venue that is
 * configured first wins the tie.
 */
export async function selectVenue(
  venues: readonly SwapVenue[],
  payerAsset: AssetCode,
  settlementAsset: AssetCode,
  amount: Money,
  strategy: ExecutionStrategy,
  policies: StrategyPolicies = DEFAULT_STRATEGY_POLICIES,
): Promise<VenueSelection> {
  if (venues.length === 0) {
    throw new ConfigurationError("No swap venue is configured", { payerAsset, settlementAsset });
  }
  if (amount.asset !== payerAsset) {
    throw new ValidationError(
      `The amount asset ${amount.asset} must equal the payer asset ${payerAsset}`,
      { amountAsset: amount.asset, payerAsset },
    );
  }
  if (payerAsset === settlementAsset) {
    throw new ValidationError("Venue selection is cross-asset only", {
      payerAsset,
      settlementAsset,
    });
  }

  const policy = policies[strategy];
  const candidate =
    policy.wait === "first-quote"
      ? await firstQuote(venues, payerAsset, settlementAsset, amount)
      : await bestQuote(venues, payerAsset, settlementAsset, amount);

  return { venue: candidate.venue, quote: candidate.quote, strategy, mev: policy.mev };
}

/** The first venue that answers wins. Rejections drop out of the race. */
async function firstQuote(
  venues: readonly SwapVenue[],
  from: AssetCode,
  to: AssetCode,
  amount: Money,
): Promise<Candidate> {
  try {
    return await Promise.any(
      venues.map(async (venue) => ({ venue, quote: await venue.quote(from, to, amount) })),
    );
  } catch (error) {
    const reasons = error instanceof AggregateError ? error.errors : [error];
    const failures = venues.map((venue, index) => ({
      venue: venue.name,
      reason: messageOf(reasons[index]),
    }));
    throw allVenuesFailed(from, to, failures);
  }
}

/** Every venue answers or fails, then the best `minOut` wins. Ties keep configuration order. */
async function bestQuote(
  venues: readonly SwapVenue[],
  from: AssetCode,
  to: AssetCode,
  amount: Money,
): Promise<Candidate> {
  const attempts = await Promise.all(
    venues.map((venue) =>
      venue.quote(from, to, amount).then(
        (quote) => ({ ok: true as const, venue, quote }),
        (error: unknown) => ({ ok: false as const, venue, error }),
      ),
    ),
  );

  const candidates = attempts.flatMap((attempt) => (attempt.ok ? [attempt] : []));
  if (candidates.length === 0) {
    const failures = attempts.flatMap((attempt) =>
      attempt.ok ? [] : [{ venue: attempt.venue.name, reason: messageOf(attempt.error) }],
    );
    throw allVenuesFailed(from, to, failures);
  }

  return candidates.reduce((lead, candidate) =>
    candidate.quote.scaledRate > lead.quote.scaledRate ? candidate : lead,
  );
}

function allVenuesFailed(
  from: AssetCode,
  to: AssetCode,
  failures: readonly { venue: string; reason: string }[],
): ProviderError {
  return new ProviderError(
    `Every venue failed to quote ${from} into ${to}`,
    { from, to, failures },
    { retryable: true },
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
