/**
 * Payment rails on the wire (#244).
 *
 * One shape, served three ways: inlined into the hosted checkout's bootstrap so
 * the page paints without a second round trip, returned from
 * `GET /v1/payment-links/:id/rails` for the embed and the SDK, and read back by
 * `assertRailOffered` before an intent is minted on a pair.
 *
 * Types only, and no dependency on the container: this module is re-exported
 * through the DTO barrel the SDK derives its response types from.
 */

import type { ChainId } from "@mayarin/chain";
import type { OfferedRail } from "@mayarin/payment-intent";
import type { AssetCode } from "@mayarin/shared";
import type { RailStanding } from "@mayarin/x402";

/** One rail, as the checkout page and the SDK read it. */
export interface RailDto {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  /** The token contract on that chain. `null` for the chain's own currency. */
  readonly contract: string | null;
  /** What the merchant is paid in on this rail's chain — what it is priced into. */
  readonly settlementAsset: AssetCode;
  /**
   * How the rail has been behaving (#260).
   *
   * Absent when the list was not ranked — a single-rail checkout renders
   * exactly as before, and a deployment without an observation source has
   * nothing to say. A `degraded` rail stays offered and selectable; the page
   * adds a note, never a gate.
   */
  readonly standing?: RailStanding;
}

/** The body of `GET /v1/payment-links/:id/rails`. */
export interface PaymentRailsDto {
  readonly rails: readonly RailDto[];
  /** What the merchant is paid in on a chain without its own override. */
  readonly settlementAsset: AssetCode;
}

export function toRailDto(rail: OfferedRail, standing?: RailStanding): RailDto {
  return {
    chain: rail.chain,
    asset: rail.asset,
    contract: rail.contract ?? null,
    settlementAsset: rail.settlementAsset,
    ...(standing === undefined ? {} : { standing }),
  };
}
