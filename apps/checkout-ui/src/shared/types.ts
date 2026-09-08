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
   * How this rail has been behaving (#260). Absent when the list was not
   * ranked. A degraded rail stays selectable — the note informs, it never gates.
   */
  readonly standing?: "healthy" | "degraded" | "unobserved";
}

export interface MerchantRef {
  readonly name: string;
  readonly city: string;
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
