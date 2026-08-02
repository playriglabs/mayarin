/**
 * Row ↔ domain mapping helpers.
 *
 * The database stores money as a numeric string plus an asset code; the domain
 * works in `Money`. Conversion happens here and nowhere else, and an asset the
 * registry does not know is a hard error rather than a silent cast — a row we
 * cannot interpret must never become a balance.
 */

import { type AssetCode, isAssetCode, type Money, ValidationError } from "@mayarr/shared";
import type { Database, Executor } from "./client.ts";

export function toAsset(value: string): AssetCode {
  if (!isAssetCode(value)) {
    throw new ValidationError(`Stored asset "${value}" is not a supported asset`, { asset: value });
  }
  return value;
}

export function toMoney(amount: string, asset: string): Money {
  return { amount: BigInt(amount), asset: toAsset(asset) };
}

export function toOptionalMoney(amount: string | null, asset: string): Money | undefined {
  return amount === null ? undefined : toMoney(amount, asset);
}

/** Money as columns. */
export function fromMoney(value: Money): { amount: string; asset: AssetCode } {
  return { amount: value.amount.toString(), asset: value.asset };
}

export function toBigint(value: string | null): bigint | undefined {
  return value === null ? undefined : BigInt(value);
}

/** Spreads a value into an object only when it is defined. */
export function present<K extends string, V>(key: K, value: V | null | undefined) {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

/**
 * Runs `fn` atomically.
 *
 * Both a pool and an open transaction expose `transaction()` — the latter opens
 * a savepoint — but they are separate types in Drizzle, so the union is
 * narrowed once, here, instead of at every call site.
 */
export async function runInTransaction<T>(
  executor: Executor,
  fn: (tx: Executor) => Promise<T>,
): Promise<T> {
  return (executor as Database).transaction(async (tx) => fn(tx));
}
