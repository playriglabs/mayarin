import { assetSymbol, isAssetCode } from "@mayarin/shared";

export function currencySymbol(currency: string | null): string {
  if (currency === null) return "";
  if (!isAssetCode(currency)) return currency;
  return assetSymbol(currency) ?? currency;
}
