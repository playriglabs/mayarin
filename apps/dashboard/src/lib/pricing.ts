/**
 * Pricing currencies for the commerce surfaces.
 *
 * A merchant prices in a currency their customers think in, which is a fiat
 * one; the stablecoin they settle in is a separate decision that lives in
 * settings. Derived from the asset registry rather than listed here, so a
 * currency admitted to the registry appears in the pricing picker without this
 * file being touched.
 *
 * Amounts are typed and sent as decimal strings — `"25000"`, `"25000.50"` —
 * which is exactly what the API's decimal money schema takes. No minor-unit
 * arithmetic happens in the browser, so there is no second implementation of
 * "how many minor units make a whole one" to drift from the one in
 * `@mayarin/shared`.
 */

import { ASSET_CODES, type AssetCode, assetSymbol, getAsset } from "@mayarin/shared/asset";

export const PRICING_CURRENCIES: readonly AssetCode[] = ASSET_CODES.filter(
  (code) => getAsset(code).kind === "fiat",
);

/** `Rp`, `RM`, `$` … for an input addon. Falls back to the code itself. */
export function symbolOf(asset: string): string {
  return (isPricingCurrency(asset) ? assetSymbol(asset) : undefined) ?? asset;
}

/** Human label for selectors; the code disambiguates shared symbols such as `$`. */
export function currencyLabel(asset: string): string {
  return `${symbolOf(asset)} ${asset}`;
}

export function isPricingCurrency(asset: string): asset is AssetCode {
  return PRICING_CURRENCIES.includes(asset as AssetCode);
}

/**
 * Whether a typed amount is a usable decimal.
 *
 * Checked in the browser only to keep the submit button honest — the server
 * parses it again and is the one that decides. Digits, optionally one dot and
 * more digits; no sign, because a negative price is not a discount.
 */
export function isValidAmount(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value.trim());
}
