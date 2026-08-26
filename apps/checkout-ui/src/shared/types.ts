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
