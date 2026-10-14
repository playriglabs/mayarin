/**
 * A date of birth typed as three numbers, as TransFi's `DD-MM-YYYY`.
 *
 * Three plain inputs rather than `<input type="date">`: that control is a
 * calendar built for choosing a day next month, and a birth year thirty years
 * back is thirty years of clicking through it. Typed, it takes a few seconds.
 *
 * Returns `undefined` for anything that is not a real calendar date — 31
 * February would otherwise roll over to March and be sent as someone else's
 * birthday.
 */
export function parseBirthDate(
  day: string,
  month: string,
  year: string,
  currentYear: number = new Date().getFullYear(),
): string | undefined {
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) {
    return undefined;
  }
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (y < 1900 || y > currentYear) return undefined;

  const date = new Date(Date.UTC(y, m - 1, d));
  const real =
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  if (!real) return undefined;

  return `${String(d).padStart(2, "0")}-${String(m).padStart(2, "0")}-${year}`;
}
