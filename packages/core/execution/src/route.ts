/**
 * Executable swap route (RFC #5 — #57).
 *
 * The quote/route split is deliberate: a quote prices a pair and is cheap; a
 * route commits to a fill and returns the calldata the `PaymentRouter` runs.
 * `SwapVenue.quote` feeds planning and selection (#44/#48); `route` feeds the
 * router call builder (#49). A venue that can only price stays a plain
 * `SwapVenue`; a venue that can also execute implements `RoutingSwapVenue`.
 *
 * Freshness: a route is more perishable than a price. The rule is build per
 * payment attempt, never cache — `expiresAt` is set only when the venue
 * states a validity window, and its absence means "rebuild before every
 * send", not "valid forever".
 *
 * The contract owns enforcement. It measures its own settlement-balance
 * delta and hard-reverts below the signed `minOut`, so a route that pays the
 * wrong recipient settles nothing, and the route's own floor can only make a
 * doomed fill revert earlier (cheaper), never change what the merchant
 * receives.
 */

import type { AssetCode, Money } from "@mayarin/shared";
import type { SwapVenue } from "./venue.ts";

export interface RouteRequest {
  readonly payerAsset: AssetCode;
  readonly settlementAsset: AssetCode;
  /** Sell amount, in `payerAsset` minor units. */
  readonly amount: Money;
  /**
   * The deployed `PaymentRouter`: the swap output must land there, because
   * the contract measures its own balance delta. For an ERC-20 sell the
   * contract also grants the route's `to` an exact allowance.
   */
  readonly recipient: string;
  /**
   * The signed lock, in `settlementAsset` minor units. Embedded as the
   * route's own floor where the venue supports one; the contract's hard
   * revert stays the enforcement either way.
   */
  readonly minOut: bigint;
}

/** The transaction fragment `payEth`/`payERC20` forward to the venue's router. */
export interface SwapRoute {
  readonly venue: string;
  /** The contract the `PaymentRouter` calls — and approves, for an ERC-20 sell. */
  readonly to: string;
  readonly data: `0x${string}`;
  /** Native value the call carries; `0n` for an ERC-20 sell. */
  readonly value: bigint;
  /** Set only when the venue states route validity; absent means rebuild per attempt. */
  readonly expiresAt?: Date;
}

/** A venue that can execute, not only price. */
export interface RoutingSwapVenue extends SwapVenue {
  /**
   * An executable route for the request. The same error rules as `quote`:
   * a pair the venue cannot serve is a `ConfigurationError`, a venue fault
   * is a retryable `ProviderError`.
   */
  route(request: RouteRequest): Promise<SwapRoute>;
}
