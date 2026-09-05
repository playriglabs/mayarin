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

/** One rail, as the checkout page and the SDK read it. */
export interface RailDto {
  readonly chain: ChainId;
  readonly asset: AssetCode;
  /** The token contract on that chain. `null` for the chain's own currency. */
  readonly contract: string | null;
}

/** The body of `GET /v1/payment-links/:id/rails`. */
export interface PaymentRailsDto {
  readonly rails: readonly RailDto[];
  /** What every rail is priced into — what the merchant is paid in. */
  readonly settlementAsset: AssetCode;
}

export function toRailDto(rail: OfferedRail): RailDto {
  return { chain: rail.chain, asset: rail.asset, contract: rail.contract ?? null };
}
