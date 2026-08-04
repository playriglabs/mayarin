/**
 * Money DTO.
 *
 * JSON has no bigint, so money crosses the wire as an exact minor-unit string
 * plus two rendered forms. Mirrors the payment API's wire shape so a dashboard
 * client and a payment client render the same `Money` identically.
 */

import { formatMoneyLocale, type Money, toDecimalString } from "@mayarin/shared";

export interface MoneyDto {
  readonly amount: string;
  readonly asset: string;
  /** Machine-readable decimal, always dot-separated and ungrouped. */
  readonly formatted: string;
  /** Human-readable, localized. Never parse this. */
  readonly display: string;
}

export function toMoneyDto(value: Money): MoneyDto {
  return {
    amount: value.amount.toString(),
    asset: value.asset,
    formatted: toDecimalString(value),
    display: formatMoneyLocale(value),
  };
}

export function optionalMoney(value: Money | undefined): MoneyDto | undefined {
  return value === undefined ? undefined : toMoneyDto(value);
}
