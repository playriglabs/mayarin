import type { Rail } from "../../shared/types.ts";
import type { LinkBootstrap } from "./types.ts";

/**
 * The body the link page posts to `/v1/payment-links/:id/checkout`.
 *
 * Pure, so the one invariant a broken deployment default would silently
 * violate stays testable: the hosted page renders a deposit address and a QR,
 * and the contract path needs the payer's own wallet to sign the router call.
 * A page with no wallet to connect cannot take that path, so the deposit path
 * is pinned here rather than left to the deployment default.
 *
 * The rail is the payer's choice, both halves of it (#244). The chain used to
 * come from the deployment's configuration, which meant a payer who picked
 * USDC could still be sent to a chain nobody asked them about.
 */
export function checkoutBody(
  bootstrap: LinkBootstrap,
  typedAmount: string,
  rail: Rail | undefined,
): Record<string, unknown> {
  return {
    ...(bootstrap.total !== null || bootstrap.currency === null
      ? {}
      : { amount: { amount: typedAmount.trim(), asset: bootstrap.currency } }),
    ...(rail === undefined
      ? {}
      : {
          payment: { asset: rail.asset, chain: rail.chain },
          executionPath: "deposit-match",
        }),
  };
}
