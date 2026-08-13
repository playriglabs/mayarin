/**
 * What the marketplace renders — the fields it uses from the wire, no more.
 *
 * The demo server passes `ProductDto` through untouched; typing only the used
 * subset keeps the browser code free of a dependency on the API package.
 */

export interface DemoPrice {
  readonly asset: string;
  /** Human form, e.g. `Rp 95.000`. Shown, never parsed. */
  readonly display: string;
}

export interface DemoProduct {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly prices: readonly DemoPrice[];
}
