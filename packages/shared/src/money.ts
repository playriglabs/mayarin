/**
 * Money.
 *
 * Every amount in Mayarin is an exact integer count of an asset's minor units.
 * Floating point never touches a balance: a `Money` is a `bigint` plus the
 * asset it is denominated in, which holds for 2-decimal fiat and 18-decimal
 * ERC-20 balances alike.
 *
 * Money is immutable. Every operation returns a new value.
 */

import { type AssetCode, assetDecimals, isAssetCode } from "./asset.ts";
import { ValidationError } from "./errors.ts";

export interface Money {
  /** Amount in the asset's minor units. */
  readonly amount: bigint;
  readonly asset: AssetCode;
}

/** Wire/DB representation. JSON has no bigint, so minor units travel as a string. */
export interface SerializedMoney {
  readonly amount: string;
  readonly asset: AssetCode;
}

export type Rounding = "half-up" | "down" | "up";

export function money(amount: bigint, asset: AssetCode): Money {
  return { amount, asset };
}

export function zero(asset: AssetCode): Money {
  return { amount: 0n, asset };
}

export function isMoney(value: unknown): value is Money {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Money).amount === "bigint" &&
    isAssetCode((value as Money).asset)
  );
}

/**
 * Parses a human decimal amount ("50000", "1.25") into minor units.
 *
 * Rejects inputs carrying more precision than the asset can represent instead
 * of silently truncating — losing a fraction of a cent without saying so is how
 * ledgers drift.
 */
export function fromDecimalString(value: string, asset: AssetCode): Money {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) {
    throw new ValidationError(`Invalid decimal amount: "${value}"`, { value, asset });
  }

  const [, sign, whole, fraction = ""] = match;
  const decimals = assetDecimals(asset);

  if (fraction.length > decimals) {
    throw new ValidationError(
      `Amount "${value}" has more precision than ${asset} supports (${decimals} decimals)`,
      { value, asset, decimals },
    );
  }

  const minorUnits = BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
  return { amount: sign === "-" ? -minorUnits : minorUnits, asset };
}

/** Renders minor units back to a fixed-precision decimal string. */
export function toDecimalString({ amount, asset }: Money): string {
  const decimals = assetDecimals(asset);
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : `.${digits.slice(digits.length - decimals)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export function formatMoney(value: Money): string {
  return `${toDecimalString(value)} ${value.asset}`;
}

export function serializeMoney(value: Money): SerializedMoney {
  return { amount: value.amount.toString(), asset: value.asset };
}

export function deserializeMoney(value: SerializedMoney): Money {
  if (!isAssetCode(value.asset)) {
    throw new ValidationError(`Unsupported asset: "${String(value.asset)}"`, { value });
  }
  return { amount: BigInt(value.amount), asset: value.asset };
}

export function assertSameAsset(a: Money, b: Money): void {
  if (a.asset !== b.asset) {
    throw new ValidationError(`Asset mismatch: ${a.asset} vs ${b.asset}`, {
      left: a.asset,
      right: b.asset,
    });
  }
}

export function add(a: Money, b: Money): Money {
  assertSameAsset(a, b);
  return { amount: a.amount + b.amount, asset: a.asset };
}

export function subtract(a: Money, b: Money): Money {
  assertSameAsset(a, b);
  return { amount: a.amount - b.amount, asset: a.asset };
}

export function negate(value: Money): Money {
  return { amount: -value.amount, asset: value.asset };
}

export function absolute(value: Money): Money {
  return { amount: value.amount < 0n ? -value.amount : value.amount, asset: value.asset };
}

export function sum(values: readonly Money[], asset: AssetCode): Money {
  return values.reduce<Money>((total, value) => add(total, value), zero(asset));
}

/**
 * Applies a basis-point rate (100 bps = 1.00%) to an amount.
 *
 * Fees and FX spreads are expressed in basis points so the caller never has to
 * hand a float to a money calculation.
 */
export function multiplyByBasisPoints(
  value: Money,
  basisPoints: number,
  rounding: Rounding = "half-up",
): Money {
  if (!Number.isInteger(basisPoints) || basisPoints < 0) {
    throw new ValidationError(`Basis points must be a non-negative integer, got ${basisPoints}`, {
      basisPoints,
    });
  }
  return {
    amount: divideRounded(value.amount * BigInt(basisPoints), 10_000n, rounding),
    asset: value.asset,
  };
}

/**
 * Fractional digits every conversion rate carries.
 *
 * A rate is the target's minor units per *whole* source unit — exact when a
 * whole source unit is worth a lot (`ETH/USDC` is about 3.7 billion) and far
 * too coarse when it is worth very little. `IDR/USDC` is about 56, so rounding
 * it to an integer costs ~25 bps, against a 50 bps fee, and it worsens as the
 * rupiah weakens.
 *
 * Nine digits puts that error below a billionth of the rate for every pair the
 * registry admits, which is smaller than the minor unit any of them settle in.
 * The alternative — a numerator/denominator per rate — is exact but doubles
 * what every rate must persist, compare and serialize, to remove an error that
 * was already immaterial at this scale.
 */
export const RATE_DECIMALS = 9;

/** `10 ** RATE_DECIMALS`, the factor a scaled rate carries. */
export const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

/**
 * Builds a scaled rate from an exact ratio, half-up.
 *
 * Producers know their rate as a ratio — a Pyth significand over a power of
 * ten, a pool's reserves, a table entry. Scaling here keeps the rounding in one
 * place instead of each adapter reinventing it, usually by truncating.
 *
 * Half-up by default, which is right for an oracle reference: it feeds a
 * deviation guard, and nearest-value is the honest reading. A venue quote
 * passes `"down"` instead, so an executable rate is never optimistic and the
 * `minOut` derived from it is never set too high.
 */
export function scaledRateFrom(
  numerator: bigint,
  denominator: bigint,
  rounding: Rounding = "half-up",
): bigint {
  if (denominator <= 0n) {
    throw new ValidationError("A rate denominator must be positive", {
      denominator: denominator.toString(),
    });
  }
  if (numerator < 0n) {
    throw new ValidationError("A rate numerator must not be negative", {
      numerator: numerator.toString(),
    });
  }
  return divideRounded(numerator * RATE_SCALE, denominator, rounding);
}

/** The whole-unit rate a scaled rate represents, for display and diagnostics. */
export function unscaleRate(scaledRate: bigint): number {
  return Number(scaledRate) / Number(RATE_SCALE);
}

/**
 * Converts an amount into another asset.
 *
 * `scaledRate` is the target asset's minor units per *whole* unit of the source
 * asset, carrying `RATE_DECIMALS` fractional digits. The scale divides out
 * here, so a caller never sees it in the result.
 */
export function convert(
  value: Money,
  target: AssetCode,
  scaledRate: bigint,
  rounding: Rounding = "half-up",
): Money {
  if (scaledRate <= 0n) {
    throw new ValidationError("Conversion rate must be positive", {
      rate: scaledRate.toString(),
    });
  }
  const sourceScale = 10n ** BigInt(assetDecimals(value.asset));
  return {
    amount: divideRounded(value.amount * scaledRate, sourceScale * RATE_SCALE, rounding),
    asset: target,
  };
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameAsset(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.asset === b.asset && a.amount === b.amount;
}

export function isZero(value: Money): boolean {
  return value.amount === 0n;
}

export function isPositive(value: Money): boolean {
  return value.amount > 0n;
}

export function isNegative(value: Money): boolean {
  return value.amount < 0n;
}

/** Integer division with an explicit rounding mode, sign-safe. */
function divideRounded(numerator: bigint, denominator: bigint, rounding: Rounding): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = magnitude / denominator;
  const remainder = magnitude % denominator;

  let rounded = quotient;
  if (remainder !== 0n) {
    if (rounding === "up") rounded += 1n;
    else if (rounding === "half-up" && remainder * 2n >= denominator) rounded += 1n;
  }

  return negative ? -rounded : rounded;
}
