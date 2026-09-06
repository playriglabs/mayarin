/**
 * Executable swap routes (RFC #5 — #57).
 *
 * `SwapVenue.quote` answers "what is the price?". This port answers "what
 * transaction performs the swap?" — and the two are deliberately separate,
 * because the second commits to a fill, costs a firmer API call, and goes stale
 * far faster than a price does.
 *
 * **Routes are exact-output.** The merchant's `minOut` is a hard lock the
 * contract enforces by reverting, so the route is asked to deliver exactly that
 * much settlement asset and no more. The payer sends a little extra to absorb
 * movement, and whatever the route does not consume comes back to them **in the
 * asset they paid with** — `PaymentRouter` returns unconsumed input and
 * route-refunded native to `refundTo`. Exact-input would work too, but it hands
 * the payer their change as a dust balance of the settlement stablecoin, which
 * for a coffee is a worse answer than a few cents of ETH back.
 *
 * Not every venue can do this. Exact-output needs the venue to price backwards
 * from a target output, and aggregators built around "spend this much" cannot.
 * A venue that cannot serve an exact-output route says so rather than quietly
 * returning an exact-input one that would leave the payer holding stablecoin
 * dust.
 */

import type { ChainId } from "@mayarin/chain";
import { type AssetCode, ConfigurationError, type Money } from "@mayarin/shared";

/**
 * What the caller needs a route for. `recipient` is always the PaymentRouter:
 * the contract measures its own settlement-balance delta, so a route paying the
 * merchant directly settles nothing and reverts on `minOut`.
 */
export interface RouteRequest {
  readonly payerAsset: AssetCode;
  readonly settlementAsset: AssetCode;
  /** Exactly what the swap must deliver — the merchant's locked `minOut`. */
  readonly exactOut: Money;
  /**
   * The most payer asset the route may consume. The payer's estimate, already
   * grossed up by the slippage bound; the route must not spend past it.
   */
  readonly maxIn: Money;
  /** The PaymentRouter address the swap must deliver into. */
  readonly recipient: string;
  /**
   * The chain the payment runs on. A venue with a pool on another chain cannot
   * route this payment — its router would have no code here — so the route
   * source refuses and the caller falls back to a venue whose pool is on this
   * chain.
   */
  readonly chain: ChainId;
}

/**
 * A route ready to hand to `payEth`/`payERC20` as their `router` and `data`
 * arguments.
 */
export interface ExecutableRoute {
  /** The DEX router to call. Must be whitelisted on-chain or the payment reverts. */
  readonly router: string;
  /** Calldata performing the swap, delivering `exactOut` to `recipient`. */
  readonly callData: `0x${string}`;
  /**
   * What the venue expects to consume. An estimate, not a commitment — the
   * contract refunds whatever is left, so this is for display and for checking
   * the route stayed within `maxIn`.
   */
  readonly expectedIn: Money;
  /** Which venue produced this, matching `SwapVenue.name`. */
  readonly source: string;
  /**
   * When the route stops being safe to submit, if the venue says. Routes go
   * stale much faster than prices; a caller holding one past this should ask
   * again rather than let the payment revert on-chain.
   */
  readonly expiresAt?: Date;
}

/**
 * Produces executable routes. Implemented by venue adapters alongside
 * `SwapVenue`, in `packages/providers/*`, so the network stays out of core.
 */
export interface SwapRouteSource {
  /** Matches the `SwapVenue.name` of the same venue. */
  readonly name: string;
  /**
   * An exact-output route, or a `ConfigurationError` if this venue cannot serve
   * the pair or cannot price exact-output at all.
   */
  route(request: RouteRequest): Promise<ExecutableRoute>;
}

/**
 * The first configured venue that can route this chain.
 *
 * A venue whose pool is on another chain refuses with a `ConfigurationError` —
 * its router has no code here — so trying the venues in order is what reaches
 * the one whose pool is on the payment's chain. Wiring a single source instead
 * pins every payment to whichever venue happened to be configured first, and a
 * second chain then fails at execution with a message about the first chain's
 * pool.
 *
 * Only a `ConfigurationError` is routed around. A real RPC or venue fault is
 * rethrown, so the caller sees the failure rather than a misleading "no venue"
 * after every source has been tried.
 */
export class FallbackRouteSource implements SwapRouteSource {
  readonly name = "fallback";
  readonly #sources: readonly SwapRouteSource[];

  constructor(sources: readonly SwapRouteSource[]) {
    this.#sources = sources;
  }

  async route(request: RouteRequest): Promise<ExecutableRoute> {
    let lastError: unknown;
    for (const source of this.#sources) {
      try {
        return await source.route(request);
      } catch (error) {
        if (!(error instanceof ConfigurationError)) throw error;
        lastError = error;
      }
    }
    if (lastError !== undefined) throw lastError;
    throw new ConfigurationError(`No route-capable venue is configured for ${request.chain}`, {
      chain: request.chain,
    });
  }
}
