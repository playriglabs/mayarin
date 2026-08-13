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

import {
  ASSET_CODES,
  type AssetCode,
  assetDecimals,
  assetSymbol,
  getAsset,
} from "@mayarin/shared/asset";

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
export function isValidAmount(value: string, asset: string): boolean {
  if (!isPricingCurrency(asset)) return false;
  const decimals = assetDecimals(asset);
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  return pattern.test(value.trim());
}

/** Renders the canonical API decimal as an editable Indonesian amount. */
export function formatAmountInput(value: string): string {
  if (value === "") return "";
  const [whole = "", fraction] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

/**
 * Turns localized input back into the API's dot-decimal form without ever
 * passing money through a JavaScript number. `undefined` means the keystroke
 * would create an invalid or over-precise value and should be ignored.
 */
export function normalizeAmountInput(value: string, asset: string): string | undefined {
  if (!isPricingCurrency(asset)) return undefined;

  const text = value.replace(/[\s\u00a0]/g, "");
  if (text === "") return "";

  const commaParts = text.split(",");
  if (commaParts.length > 2) return undefined;

  const [rawWhole = "", commaFraction] = commaParts;
  let whole = rawWhole;
  let fraction = commaFraction;

  if (commaFraction === undefined) {
    const decimals = assetDecimals(asset);
    const canonicalDecimal = new RegExp(`^(\\d+)\\.(\\d{1,${decimals}})$`).exec(rawWhole);
    if (canonicalDecimal !== null && !/^\d{1,3}(?:\.\d{3})+$/.test(rawWhole)) {
      [, whole = "", fraction] = canonicalDecimal;
    } else {
      whole = rawWhole.replaceAll(".", "");
    }
  } else {
    whole = rawWhole.replaceAll(".", "");
  }

  if (!/^\d*$/.test(whole) || (fraction !== undefined && !/^\d*$/.test(fraction))) {
    return undefined;
  }
  if (fraction !== undefined && fraction.length > assetDecimals(asset)) return undefined;

  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  return fraction === undefined ? normalizedWhole : `${normalizedWhole}.${fraction}`;
}
