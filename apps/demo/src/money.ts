/**
 * IDR rendering for client-side arithmetic (quantity × unit price).
 *
 * The wire's `display` covers the unit price; a line total must be computed,
 * and `MoneyDto.amount` (minor units) is the field meant for arithmetic.
 * Formatting works on the digit string — no `number` ever holds money.
 */

/** IDR minor units per whole rupiah has two decimals on the wire. */
const IDR_DECIMALS = 2;

export function formatIdrMinorUnits(minorUnits: bigint): string {
  const digits = minorUnits.toString().padStart(IDR_DECIMALS + 1, "0");
  const cents = digits.slice(-IDR_DECIMALS);
  const whole = digits.slice(0, -IDR_DECIMALS);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `Rp ${grouped},${cents}`;
}

export function lineTotal(unitMinorUnits: string, quantity: number): string {
  return formatIdrMinorUnits(BigInt(unitMinorUnits) * BigInt(quantity));
}
