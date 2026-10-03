/**
 * The values every page shares.
 *
 * Mirrored by hand from the payloads the API builds
 * (`apps/api/src/routes/checkout-page.ts`, `invoice-page.ts`), the same way
 * `apps/demo` mirrors the SDK's DTOs. The API's endpoint tests pin the shape on
 * the other side of the seam.
 */

/** Money on the wire. `display` is for people; never parse it. */
export interface MoneyDto {
  readonly amount: string;
  readonly asset: string;
  readonly formatted: string;
  readonly display: string;
}

/**
 * One `(chain, asset)` pair the payer may choose (#244).
 *
 * The page never picks a chain of its own: the rails it is given are the pairs
 * this merchant can actually be paid on, filtered per chain rather than unioned
 * across them, so a payer on Arc is never offered ETH.
 */
export interface Rail {
  readonly chain: string;
  readonly asset: string;
  /** The token contract on that chain. `null` for the chain's own currency. */
  readonly contract: string | null;
  /**
   * What the merchant is paid in on this chain. The estimate quotes against
   * it: it decides whether the payer's asset has a swap leg.
   */
  readonly settlementAsset: string;
  /**
   * How this rail has been behaving (#260). Absent when the list was not
   * ranked. A degraded rail stays selectable — the note informs, it never gates.
   */
  readonly standing?: "healthy" | "degraded" | "unobserved";
}

/**
 * Buyer protection on offer (#304), as the API states it. `required` when the
 * merchant asked for escrow on this one payment; otherwise the buyer opts in
 * by connecting a wallet.
 */
export interface Protection {
  readonly holdSeconds: number;
  /** After the hold, how long the arbiter has before an open dispute refunds the buyer. */
  readonly arbitrationSeconds: number;
  /** "Mayarin Resolution", a shortened address, or "no one". */
  readonly arbiterLabel: string;
  /** Chains with an escrow factory; protection applies on these only. */
  readonly chains: readonly string[];
  readonly required: boolean;
  /** The dispute bond in basis points of the payment (#315); 0 is free. */
  readonly bondBps: number;
  /** Chains where the bond applies; elsewhere disputing is free. */
  readonly bondChains: readonly string[];
}

export interface MerchantRef {
  readonly name: string;
  readonly city: string;
  /** The logo uploaded in dashboard Settings, or `null` for the Mayarin mark. */
  readonly logoUrl: string | null;
}

/** A priced line on the order summary — the link page and the payment page show the same one. */
export interface LineItem {
  readonly name: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly quantity: number;
  readonly unitPrice: MoneyDto;
  readonly lineTotal: MoneyDto;
}
