/**
 * When the foreign-exchange market is open.
 *
 * Crypto settles every hour of every day; fiat FX does not. Pyth's
 * `FX.USD/IDR` publishes from the Sydney open on Sunday to the New York close
 * on Friday and is silent in between, so a merchant pricing in IDR cannot be
 * quoted on a Saturday against a fresh rate — there is no fresh rate to read.
 *
 * That leaves two honest options and one dishonest one. The dishonest one is
 * widening the staleness bound to a few days outright, which also blinds the
 * guard on a Tuesday, when a feed that stopped publishing is exactly the
 * failure it exists to catch. The honest ones are to refuse the payment, or to
 * accept a known-closed-market rate under a *separate* bound and price the
 * risk. This module supplies the predicate the second option needs.
 *
 * **The calendar is the only signal here, and it does not know about
 * holidays.** On Christmas Day this returns `true` while the feed publishes
 * nothing, and the fiat leg fails on staleness as it does today. That is the
 * safe direction to be wrong in: a missed close costs an availability, a missed
 * *open* would price a payment off a rate nobody was quoting.
 *
 * Boundaries are UTC and fixed. The real open and close track New York's
 * daylight-saving shifts by an hour twice a year; the closed-market bound
 * absorbs that hour, since it is a tolerance for a multi-day gap rather than a
 * precise market-microstructure clock.
 */

/** Sunday, the hour the week's first session opens (Sydney). */
const WEEK_OPEN_HOUR_UTC = 21;
/** Friday, the hour the week's last session closes (New York). */
const WEEK_CLOSE_HOUR_UTC = 21;

const SUNDAY = 0;
const FRIDAY = 5;
const SATURDAY = 6;

/**
 * Whether the FX market is trading at `now`.
 *
 * Pure, with time injected, so the fiat leg stays testable without a clock and
 * a weekend is reproducible in a unit test rather than something that only
 * happens twice a week.
 */
export function isFxMarketOpen(now: Date): boolean {
  const day = now.getUTCDay();
  const hour = now.getUTCHours();

  if (day === SATURDAY) return false;
  if (day === SUNDAY) return hour >= WEEK_OPEN_HOUR_UTC;
  if (day === FRIDAY) return hour < WEEK_CLOSE_HOUR_UTC;
  return true;
}
