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

/**
 * The checkout reads amounts the way the rest of the product writes them
 * (`Rp 50.432,00`): `.` groups thousands, `,` marks the decimal. It does not
 * follow the browser, so one payer sees one form on every page and device.
 */
const AMOUNT_LOCALE = "id-ID";

function separators(locale: string): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1000.5);
  return {
    group: parts.find((part) => part.type === "group")?.value ?? ",",
    decimal: parts.find((part) => part.type === "decimal")?.value ?? ".",
  };
}

/**
 * A typed amount as the payer reads it: `10000` shows as `10.000` and
 * `1234.5` as `1.234,5`. Takes and returns strings, so a half-typed `1000.` keeps
 * its point and no number ever rounds what was typed.
 */
export function groupAmount(machine: string, locale = AMOUNT_LOCALE): string {
  const { group, decimal } = separators(locale);
  const [whole = "", fraction] = machine.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return fraction === undefined ? grouped : `${grouped}${decimal}${fraction}`;
}

/**
 * What the field holds after an edit, back to the machine form. The locale's
 * own group mark is dropped and its decimal mark becomes a point; the rest is
 * `sanitizeAmount`.
 */
export function ungroupAmount(
  raw: string,
  currency: string | null,
  locale = AMOUNT_LOCALE,
): string {
  const { group, decimal } = separators(locale);
  const plain = raw.split(group).join("").split(decimal).join(".");
  return sanitizeAmount(plain, currency);
}
