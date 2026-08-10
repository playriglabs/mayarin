/**
 * Money helpers for the dashboard.
 *
 * `MoneyDto` carries three forms on the wire: `amount` to calculate with,
 * `formatted` to parse, and `display` to show. A component that only renders a
 * single value uses `display` directly and needs nothing from here. This module
 * exists for the one case `display` cannot serve — adding several values up for
 * a stat tile.
 *
 * Arithmetic goes through `@mayarin/shared`, which owns how many minor units
 * make a whole unit. No float ever appears: `amount` parses straight to
 * `bigint`, and the total is rendered by the same locale formatter the payment
 * API uses.
 */

import { type AssetCode, isAssetCode } from "@mayarin/shared/asset";
import { formatMoneyLocale } from "@mayarin/shared/locale";
import { type Money, money } from "@mayarin/shared/money";
import type { MoneyDto } from "@/types/payment";

/**
 * Reads a `MoneyDto` into a `Money`. Returns `undefined` for an asset this
 * build does not know, so a newly admitted asset degrades one row rather than
 * throwing the page away.
 */
export function fromDto(dto: MoneyDto): Money | undefined {
  if (!isAssetCode(dto.asset)) return undefined;
  return money(BigInt(dto.amount), dto.asset);
}

/**
 * Totals values that share an asset, ignoring any that do not. Mixed assets
 * cannot be added — there is no rate here — so the caller picks the asset and
 * this reports only that slice.
 */
export function totalIn(values: readonly MoneyDto[], asset: AssetCode): Money {
  const total = values
    .filter((v) => v.asset === asset)
    .reduce((acc, v) => acc + BigInt(v.amount), 0n);
  return money(total, asset);
}

/** The asset that appears most often, or `undefined` for an empty list. */
export function dominantAsset(values: readonly MoneyDto[]): AssetCode | undefined {
  const counts = new Map<AssetCode, number>();
  for (const v of values) {
    if (!isAssetCode(v.asset)) continue;
    counts.set(v.asset, (counts.get(v.asset) ?? 0) + 1);
  }
  let best: AssetCode | undefined;
  let bestCount = 0;
  for (const [asset, count] of counts) {
    if (count > bestCount) {
      best = asset;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Human form, `id-ID` by default — `Rp 50.432,00`. Never parse this back.
 *
 * Trailing zeros past two decimals are dropped, matching what the APIs put in
 * a `MoneyDto`'s `display`: a total rendered here and the same total rendered
 * server-side must not differ by six zeros.
 */
export function display(value: Money): string {
  return formatMoneyLocale(value, { trimTrailingZeros: true });
}
