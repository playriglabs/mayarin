/**
 * What the storefront renders — the fields it uses from the wire, no more.
 *
 * The server passes `ProductDto` through untouched; typing only the used
 * subset keeps the browser code free of a dependency on the API package.
 */

export interface DemoPrice {
  readonly asset: string;
  /** Minor units as an integer string. The field for arithmetic. */
  readonly amount: string;
  /** Human form, e.g. `Rp 129.000,00`. Shown, never parsed. */
  readonly display: string;
}

export interface DemoProduct {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly prices: readonly DemoPrice[];
  /**
   * Free-form product metadata. The seed sets `image` (the product photo),
   * `kind` (its fallback photo), and `category` (the catalog filter).
   */
  readonly metadata: Readonly<Record<string, string>>;
}
