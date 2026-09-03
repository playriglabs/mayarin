/**
 * The boundary between the wire's atomic-unit strings and the domain's `Money`.
 *
 * This is the only file that crosses it. Everywhere else, an amount is either a
 * `Money` (inside) or a string (on the wire) and never quietly both — the
 * failure this prevents is a `number` appearing between them, which is exactly
 * how an 18-decimal balance loses its low digits.
 */

import type { AssetCode, Money } from "@mayarin/shared";
import { money, ValidationError } from "@mayarin/shared";

/** Atomic units, base 10, no sign and no separators. */
const ATOMIC = /^\d+$/;

/**
 * Parse an atomic-unit string from the wire into a `Money`.
 *
 * Rejects anything that is not a run of digits. A leading `+`, a decimal point
 * or a hex prefix is a malformed payment, not a number to coerce: `BigInt("")`
 * is `0n` and `BigInt("0x10")` is `16n`, and either would turn a bad request
 * into a wrong amount.
 */
export function parseAtomicAmount(value: string, asset: AssetCode): Money {
  if (!ATOMIC.test(value)) {
    throw new ValidationError(`x402 amount must be atomic units in base 10, received "${value}"`);
  }
  return money(BigInt(value), asset);
}

/** Render a `Money` as the wire's atomic-unit string. */
export function toAtomicAmount(value: Money): string {
  if (value.amount < 0n) {
    throw new ValidationError("x402 amount cannot be negative");
  }
  return value.amount.toString();
}

/**
 * Parse a Unix-seconds string from an authorization.
 *
 * Separate from `parseAtomicAmount` despite the identical shape, because the
 * two mean different things and a shared helper would let a timestamp be
 * validated as an amount the day one of them gains a rule.
 */
export function parseUnixSeconds(value: string, field: string): bigint {
  if (!ATOMIC.test(value)) {
    throw new ValidationError(`x402 ${field} must be Unix seconds, received "${value}"`);
  }
  return BigInt(value);
}

/** Unix seconds for an instant, as the wire spells it. */
export function toUnixSeconds(at: Date): string {
  return Math.floor(at.getTime() / 1000).toString();
}
