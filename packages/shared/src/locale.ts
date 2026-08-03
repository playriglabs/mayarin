/**
 * Locale rendering for money.
 *
 * `toDecimalString` is the machine form: an unpunctuated, dot-separated decimal
 * that parses back to the exact same minor units. Humans do not read it.
 * Indonesia groups thousands with `.` and marks the decimal with `,`, so the
 * amount a machine renders as `50432.00` is written **Rp 50.432,00** — the dot
 * there is a thousands separator, not a decimal point.
 *
 * Formatting operates on the digit string, never on a `number`. Routing an
 * 18-decimal ERC-20 balance through `Intl.NumberFormat` would round it, and a
 * rounded balance is a wrong balance.
 */

import { type AssetCode, assetSymbol } from "./asset.ts";
import { ValidationError } from "./errors.ts";
import { fromDecimalString, type Money, toDecimalString } from "./money.ts";

export interface LocaleFormat {
  /** Separator between groups of three digits. */
  readonly group: string;
  /** Separator before the fractional digits. */
  readonly decimal: string;
}

export const LOCALE_FORMATS = {
  "id-ID": { group: ".", decimal: "," },
  "en-US": { group: ",", decimal: "." },
} as const satisfies Record<string, LocaleFormat>;

export type LocaleCode = keyof typeof LOCALE_FORMATS;

/** Indonesia is the first market, so its conventions are the default. */
export const DEFAULT_LOCALE: LocaleCode = "id-ID";

export interface MoneyFormatOptions {
  readonly locale?: LocaleCode;
  /** Prefix the asset's symbol, or suffix its code. Defaults to `true`. */
  readonly symbol?: boolean;
  /** Drop an all-zero fraction: `Rp 50.432` rather than `Rp 50.432,00`. */
  readonly trimZeroFraction?: boolean;
}

/**
 * Renders money the way its market writes it.
 *
 * ```ts
 * formatMoneyLocale(money(5_043_200n, "IDR"))                        // "Rp 50.432,00"
 * formatMoneyLocale(money(5_043_200n, "IDR"), { trimZeroFraction: true }) // "Rp 50.432"
 * formatMoneyLocale(money(5_043_200n, "IDRX"))                       // "50.432,00 IDRX"
 * ```
 */
export function formatMoneyLocale(value: Money, options: MoneyFormatOptions = {}): string {
  const { locale = DEFAULT_LOCALE, symbol = true, trimZeroFraction = false } = options;
  const format = LOCALE_FORMATS[locale];

  const machine = toDecimalString(value);
  const negative = machine.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? machine.slice(1) : machine).split(".");

  const grouped = groupDigits(whole, format.group);
  const keepFraction = fraction !== "" && !(trimZeroFraction && /^0+$/.test(fraction));
  const digits = `${negative ? "-" : ""}${grouped}${keepFraction ? format.decimal + fraction : ""}`;

  if (!symbol) return digits;

  const currency = assetSymbol(value.asset);
  return currency === undefined ? `${digits} ${value.asset}` : `${currency} ${digits}`;
}

/**
 * Reads a locale-written amount back into exact minor units.
 *
 * Group separators must actually group — `"50.432"` is fifty thousand under
 * `id-ID`, but `"50.43"` is rejected rather than guessed at, because a reader
 * cannot tell whether it meant a malformed group or a decimal point.
 */
export function parseMoneyLocale(
  value: string,
  asset: AssetCode,
  options: Pick<MoneyFormatOptions, "locale"> = {},
): Money {
  const { locale = DEFAULT_LOCALE } = options;
  const format = LOCALE_FORMATS[locale];

  const symbol = assetSymbol(asset);
  let text = value.replace(/[\s\u00a0]/g, "");
  if (symbol !== undefined && text.startsWith(symbol)) text = text.slice(symbol.length);
  if (text.endsWith(asset)) text = text.slice(0, -asset.length);

  const group = escapeRegExp(format.group);
  const decimal = escapeRegExp(format.decimal);
  const pattern = new RegExp(`^(-?)(\\d{1,3}(?:${group}\\d{3})*|\\d+)(?:${decimal}(\\d+))?$`);

  const match = pattern.exec(text);
  if (match === null) {
    throw new ValidationError(`Invalid ${locale} amount: "${value}"`, { value, asset, locale });
  }

  const [, sign = "", whole = "", fraction] = match;
  const machine = `${sign}${whole.split(format.group).join("")}${
    fraction === undefined ? "" : `.${fraction}`
  }`;

  return fromDecimalString(machine, asset);
}

/** Inserts a separator every three digits, counting from the right. */
function groupDigits(digits: string, separator: string): string {
  if (separator === "") return digits;
  return digits.replace(/\B(?=(\d{3})+$)/g, separator);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
