/**
 * The currency the dashboard shows money in.
 *
 * Every figure the dashboard adds up is held in USD cents. This is the one place
 * that turns them into the merchant's own currency, at the rate the API sent
 * with the data, so no component knows there is a choice. Display only: nothing
 * priced or settled in it.
 *
 * Module state rather than props because the formatters are called from plain
 * functions, deep inside series builders. It is set once per render, right after
 * the data loads and before anything is formatted.
 */

import { formatMoneyLocale } from "@mayarin/shared/locale";
import { money } from "@mayarin/shared/money";

/** A rate has six decimals: the finest unit a rate is carried in. */
const RATE_SCALE = 1_000_000n;

let currency = "USD";
let perUsd = RATE_SCALE;

export interface DisplayCurrencyDto {
  readonly currency: string;
  /** Units of `currency` one US dollar buys, as a decimal string. */
  readonly perUsd: string;
}

export function setDisplayCurrency(display: DisplayCurrencyDto): void {
  currency = display.currency;
  perUsd = scaledRate(display.perUsd);
}

export function displayCurrency(): string {
  return currency;
}

/** `"16000.5"` as `16000500000n`, never through a float. */
function scaledRate(decimal: string): bigint {
  const [whole = "0", fraction = ""] = decimal.split(".");
  return BigInt(whole) * RATE_SCALE + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

/** USD cents in the display currency, truncated: a balance shown as more than it is invites a failed withdrawal. */
export function formatUsdCents(cents: bigint, options?: { trimZeroFraction?: boolean }): string {
  if (currency === "USD") return formatMoneyLocale(money(cents, "USD"), options);

  const converted = (cents * perUsd) / RATE_SCALE;
  const fraction = converted % 100n;
  const amount = `${converted / 100n}.${fraction.toString().padStart(2, "0")}` as `${number}`;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency,
    ...(options?.trimZeroFraction === true && fraction === 0n ? { minimumFractionDigits: 0 } : {}),
  }).format(amount);
}
