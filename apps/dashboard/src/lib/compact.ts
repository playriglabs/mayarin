/**
 * Compact money labels for chart axes.
 *
 * An axis tick has no room for `Rp 374.200.000,00`, but it must not become a
 * float to get shorter. Everything here is integer arithmetic on `bigint`: the
 * one decimal place is produced by scaling by ten and splitting the digits, so
 * no rounding error can reach a label.
 *
 * Indonesian magnitude suffixes: rb (ribu), jt (juta), m (miliar), t (triliun).
 */

const UNITS: readonly (readonly [bigint, string])[] = [
  [1_000_000_000_000n, "t"],
  [1_000_000_000n, "m"],
  [1_000_000n, "jt"],
  [1_000n, "rb"],
];

/** `minor` is minor units; `decimals` is how many of them make a whole unit. */
export function compactMoney(minor: bigint, decimals: number, symbol: string): string {
  const whole = minor / 10n ** BigInt(decimals);
  if (whole === 0n) return `${symbol} 0`;

  for (const [unit, suffix] of UNITS) {
    if (whole < unit) continue;
    // One decimal place, without ever leaving integer arithmetic.
    const tenths = (whole * 10n) / unit;
    const intPart = tenths / 10n;
    const frac = tenths % 10n;
    return frac === 0n ? `${symbol} ${intPart}${suffix}` : `${symbol} ${intPart},${frac}${suffix}`;
  }
  return `${symbol} ${whole}`;
}

/**
 * A value's share of a maximum, as a percentage for CSS. The division happens
 * in `bigint` and only the finished ratio becomes a number, so a large rupiah
 * total cannot lose precision on the way to a bar height.
 */
export function percentOf(value: bigint, max: bigint): number {
  if (max <= 0n) return 0;
  return Number((value * 10_000n) / max) / 100;
}
