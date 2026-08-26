import type { LinkBootstrap } from "./types.ts";

/**
 * The body the link page posts to `/v1/payment-links/:id/checkout`.
 *
 * Pure, so the one invariant a broken deployment default would silently
 * violate stays testable: the hosted page renders a deposit address and a QR,
 * and the contract path needs the payer's own wallet to sign the router call.
 * A page with no wallet to connect cannot take that path, so the deposit path
 * is pinned here rather than left to the deployment default.
 */
export function checkoutBody(
  bootstrap: LinkBootstrap,
  typedAmount: string,
  asset: string | undefined,
): Record<string, unknown> {
  return {
    ...(bootstrap.total !== null || bootstrap.currency === null
      ? {}
      : { amount: { amount: typedAmount.trim(), asset: bootstrap.currency } }),
    ...(asset === undefined
      ? {}
      : {
          payment: { asset, chain: bootstrap.chain },
          executionPath: "deposit-match",
        }),
  };
}
