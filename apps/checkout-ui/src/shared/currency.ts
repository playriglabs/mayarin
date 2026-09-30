import { assetDecimals, assetSymbol, isAssetCode } from "@mayarin/shared";

export function currencySymbol(currency: string | null): string {
  if (currency === null) return "";
  if (!isAssetCode(currency)) return currency;
  return assetSymbol(currency) ?? currency;
}

/**
 * What a typed amount may contain: digits and one decimal point, no more
 * decimals than the currency has. A comma is read as the point, since a buyer
 * in most of Europe and Southeast Asia types one. Anything else is dropped as
 * it is typed, so the field never holds a value the quote would refuse.
 */
export function sanitizeAmount(raw: string, currency: string | null): string {
  const decimals = currency !== null && isAssetCode(currency) ? assetDecimals(currency) : 2;
  const cleaned = raw.replace(",", ".").replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  if (rest.length === 0 || decimals === 0) return whole;
  return `${whole}.${rest.join("").slice(0, decimals)}`;
}
