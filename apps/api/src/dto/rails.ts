/**
 * Payment rails on the wire (#244).
 *
 * One shape, served three ways: inlined into the hosted checkout's bootstrap so
 * the page paints without a second round trip, returned from
 * `GET /v1/payment-links/:id/rails` for the embed and the SDK, and read back by
 * the guard below before an intent is minted on a pair.
 *
 * The guard is the reason the catalog is worth having at all. A rail that fails
 * a precondition used to fail at price-lock — after the payer had chosen, after
 * a deposit address had been burned — and the message they got was about a
 * settlement address they had never heard of. Refusing before the choice, with
 * the reason the catalog already computed, is the whole point.
 */

import type { ChainId } from "@mayarin/chain";
import type { OfferedRail, RailReport } from "@mayarin/payment-intent";
import { type AssetCode, ValidationError } from "@mayarin/shared";
import type { Container } from "../container.ts";

/** One rail, as the checkout page and the SDK read it. */
export interface RailDto {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  /** The token contract on that chain. `null` for the chain's own currency. */
  readonly contract: string | null;
}

export function toRailDto(rail: OfferedRail): RailDto {
  return { chain: rail.chain, asset: rail.asset, contract: rail.contract ?? null };
}

/**
 * Refuses a pair the catalog does not offer, with the reason it was dropped.
 *
 * Never a generic validation error: the catalog knows whether the chain has no
 * settlement destination, whether the asset cannot be priced, or whether the
 * merchant does not accept it there, and a payer or an integrator can act on
 * exactly one of those.
 */
export async function assertRailOffered(
  container: Container,
  merchantId: string,
  rail: { readonly asset: AssetCode; readonly chain: ChainId } | undefined,
): Promise<void> {
  if (rail === undefined) return;

  const report = await container.rails.describe(merchantId);
  if (
    report.rails.some((offered) => offered.chain === rail.chain && offered.asset === rail.asset)
  ) {
    return;
  }

  throw new ValidationError(refusalFor(report, rail), {
    asset: rail.asset,
    chain: rail.chain,
    rails: report.rails.map((offered) => `${offered.chain}:${offered.asset}`),
  });
}

function refusalFor(
  report: RailReport,
  rail: { readonly asset: AssetCode; readonly chain: ChainId },
): string {
  // The most specific reason first: a pair-level exclusion says something about
  // this exact rail, while a chain-level one says the chain was never on offer.
  const exclusion =
    report.unavailable.find(
      (entry) => entry.chain === rail.chain && "asset" in entry && entry.asset === rail.asset,
    ) ?? report.unavailable.find((entry) => entry.chain === rail.chain);

  if (exclusion !== undefined) {
    return `${rail.asset} on ${rail.chain} cannot be paid: ${exclusion.reason}`;
  }

  const offered = report.rails.map((entry) => `${entry.asset} on ${entry.chain}`).join(", ");
  return offered.length === 0
    ? `${rail.asset} on ${rail.chain} cannot be paid, and this merchant has no payment rail available`
    : `${rail.asset} on ${rail.chain} cannot be paid; available rails are ${offered}`;
}
