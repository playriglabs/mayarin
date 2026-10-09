/**
 * Analytics series: the filtered read, bucketed by interval over a whole range.
 *
 * Every bucket in the range is present, including the empty ones. A series of
 * only the days that had a payment draws a line straight across the gaps —
 * three points over a month reads as a steady trend between them, when most of
 * that month had nothing at all.
 *
 * Money stays in `bigint` USD cents until a figure is rendered; the plotted
 * `value` is a float only because geometry is.
 */

import { formatMoneyLocale } from "@mayarin/shared/locale";
import { money } from "@mayarin/shared/money";
import { inWindow } from "@/lib/analytics-insights";
import { payInAmountUsd, settlementsByPaymentIntent } from "@/lib/analytics-movements";
import { toUsdCents } from "@/lib/money";
import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

export type Interval = "day" | "week" | "month";

export interface Range {
  /** Inclusive UTC day key, `2026-09-10`. */
  readonly from: string;
  /** Inclusive UTC day key. */
  readonly to: string;
}

export interface Filters {
  /** A chain id, or `undefined` for every network. */
  readonly chain?: string | undefined;
  /** The asset the payer sent, or `undefined` for every asset. */
  readonly asset?: string | undefined;
}

export interface MetricPoint {
  /** The bucket's first day. */
  readonly date: string;
  readonly value: number;
  readonly display: string;
}

export interface Metric {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly chart: "line" | "bar";
  readonly points: readonly MetricPoint[];
  /** The figure for the whole range — a sum, a ratio or a median, per metric. */
  readonly total: string;
  /** Percent change of the range's figure against the range before it. */
  readonly change: number | undefined;
}

const DAY_MS = 86_400_000;

function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function timeOf(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

/** The first day of the bucket a day falls in. Weeks start on Monday. */
export function bucketOf(day: string, interval: Interval): string {
  if (interval === "day") return day;
  if (interval === "month") return `${day.slice(0, 7)}-01`;
  const time = timeOf(day);
  const sinceMonday = (new Date(time).getUTCDay() + 6) % 7;
  return dayKey(time - sinceMonday * DAY_MS);
}

/** Every bucket from the one holding `from` through the one holding `to`. */
export function bucketsOf(range: Range, interval: Interval): readonly string[] {
  const last = bucketOf(range.to, interval);
  const buckets: string[] = [];
  let bucket = bucketOf(range.from, interval);
  while (bucket <= last) {
    buckets.push(bucket);
    if (interval === "day") bucket = dayKey(timeOf(bucket) + DAY_MS);
    else if (interval === "week") bucket = dayKey(timeOf(bucket) + 7 * DAY_MS);
    else {
      const date = new Date(timeOf(bucket));
      bucket = dayKey(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
    }
  }
  return buckets;
}

/** The range of the same length that ends the day before this one starts. */
export function previousRange(range: Range): Range {
  const length = (timeOf(range.to) - timeOf(range.from)) / DAY_MS + 1;
  const to = timeOf(range.from) - DAY_MS;
  return { from: dayKey(to - (length - 1) * DAY_MS), to: dayKey(to) };
}

/** The last `days` days, today included. */
export function lastDays(today: Date, days: number): Range {
  const to = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return { from: dayKey(to - (days - 1) * DAY_MS), to: dayKey(to) };
}

function windowOf(range: Range) {
  return { from: timeOf(range.from), to: timeOf(range.to) + DAY_MS };
}

/** Payments created within the range. */
export function paymentsInRange(
  payments: readonly PaymentIntentDto[],
  range: Range,
): readonly PaymentIntentDto[] {
  const window = windowOf(range);
  return payments.filter((payment) => inWindow(payment.createdAt, window));
}

/** Settlements that settled, or last moved, within the range. */
export function settlementsInRange(
  settlements: readonly SettlementDto[],
  range: Range,
): readonly SettlementDto[] {
  const window = windowOf(range);
  return settlements.filter((settlement) => inWindow(settledAt(settlement), window));
}

function settlementChain(settlement: SettlementDto): string | undefined {
  return settlement.chain?.chain ?? settlement.payment?.chain;
}

export function filterPayments(
  payments: readonly PaymentIntentDto[],
  filters: Filters,
): readonly PaymentIntentDto[] {
  return payments.filter(
    (payment) =>
      (filters.chain === undefined || payment.payment?.chain === filters.chain) &&
      (filters.asset === undefined || payment.payment?.asset === filters.asset),
  );
}

export function filterSettlements(
  settlements: readonly SettlementDto[],
  filters: Filters,
): readonly SettlementDto[] {
  return settlements.filter(
    (settlement) =>
      (filters.chain === undefined || settlementChain(settlement) === filters.chain) &&
      (filters.asset === undefined || settlement.payment?.asset === filters.asset),
  );
}

export function isSettled(settlement: SettlementDto): boolean {
  return settlement.state === "SUCCESS" || settlement.state === "SETTLED";
}

function settledAt(settlement: SettlementDto): string {
  return settlement.completedAt ?? settlement.updatedAt;
}

function secondsBetween(from: string, to: string | null): number | undefined {
  if (to === null) return undefined;
  const elapsed = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : undefined;
}

function median(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

export function formatUsd(cents: bigint): string {
  return formatMoneyLocale(money(cents, "USD"), { trimZeroFraction: true });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3_600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3_600).toFixed(1)}h`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function changeOf(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Everything one range contributes, gathered per bucket in a single pass. */
interface Bucket {
  revenue: bigint;
  orders: number;
  checkouts: number;
  failed: number;
  completion: number[];
  net: bigint;
  fees: bigint;
  settlements: number;
  settlementTime: number[];
}

function emptyBucket(): Bucket {
  return {
    revenue: 0n,
    orders: 0,
    checkouts: 0,
    failed: 0,
    completion: [],
    net: 0n,
    fees: 0n,
    settlements: 0,
    settlementTime: [],
  };
}

function gather(
  payments: readonly PaymentIntentDto[],
  settlements: readonly SettlementDto[],
  range: Range,
  interval: Interval,
  rates: Readonly<Record<string, string>>,
): ReadonlyMap<string, Bucket> {
  const buckets = new Map(bucketsOf(range, interval).map((key) => [key, emptyBucket()]));
  const window = windowOf(range);
  const byIntent = settlementsByPaymentIntent(settlements);

  // Pay ins are dated by creation: an order belongs to the day it was placed.
  for (const payment of payments) {
    if (!inWindow(payment.createdAt, window)) continue;
    const bucket = buckets.get(bucketOf(payment.createdAt.slice(0, 10), interval));
    if (bucket === undefined) continue;
    bucket.checkouts += 1;
    if (payment.status === "FAILED" || payment.status === "EXPIRED") bucket.failed += 1;
    if (payment.status !== "COMPLETED") continue;
    bucket.orders += 1;
    bucket.revenue += payInAmountUsd(payment, byIntent.get(payment.id)) ?? 0n;
    const seconds = secondsBetween(payment.createdAt, payment.completedAt);
    if (seconds !== undefined) bucket.completion.push(seconds);
  }

  // Pay outs are dated by arrival. An asset with no USD rate is left out, not guessed.
  for (const settlement of settlements) {
    if (!isSettled(settlement) || !inWindow(settledAt(settlement), window)) continue;
    const bucket = buckets.get(bucketOf(settledAt(settlement).slice(0, 10), interval));
    if (bucket === undefined) continue;
    bucket.settlements += 1;
    const usd = (value: SettlementDto["fee"]) =>
      value === null ? 0n : (toUsdCents(BigInt(value.amount), value.asset, rates) ?? 0n);
    bucket.net += usd(settlement.netAmount);
    bucket.fees += usd(settlement.fee);
    const seconds = secondsBetween(settlement.createdAt, settlement.completedAt);
    if (seconds !== undefined) bucket.settlementTime.push(seconds);
  }

  return buckets;
}

/** The whole range folded into one bucket, for the headline figure and the trend. */
function fold(buckets: ReadonlyMap<string, Bucket>): Bucket {
  const all = emptyBucket();
  for (const bucket of buckets.values()) {
    all.revenue += bucket.revenue;
    all.orders += bucket.orders;
    all.checkouts += bucket.checkouts;
    all.failed += bucket.failed;
    all.completion.push(...bucket.completion);
    all.net += bucket.net;
    all.fees += bucket.fees;
    all.settlements += bucket.settlements;
    all.settlementTime.push(...bucket.settlementTime);
  }
  return all;
}

interface Definition {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly chart?: "line" | "bar";
  /** The plotted value and its label, for one bucket. */
  readonly point: (bucket: Bucket) => { value: number; display: string };
}

const moneyPoint = (cents: bigint) => ({ value: Number(cents) / 100, display: formatUsd(cents) });
const countPoint = (value: number, unit: string) => ({
  value,
  display: `${value} ${unit}${value === 1 ? "" : "s"}`,
});
const ratioPoint = (part: number, whole: number) => {
  const ratio = whole === 0 ? 0 : part / whole;
  return { value: ratio * 100, display: formatPercent(ratio) };
};
const durationPoint = (samples: readonly number[]) => {
  const seconds = median(samples);
  return { value: seconds, display: samples.length === 0 ? "—" : formatDuration(seconds) };
};
const averagePoint = (bucket: Bucket) =>
  moneyPoint(bucket.orders === 0 ? 0n : bucket.revenue / BigInt(bucket.orders));

export const REVENUE: readonly Definition[] = [
  {
    key: "revenue",
    label: "Revenue",
    hint: "Gross USD value of completed payments, at each payment's locked rate, dated by when it was created.",
    point: (bucket) => moneyPoint(bucket.revenue),
  },
  {
    key: "net-revenue",
    label: "Net revenue",
    hint: "What reached you after fees, in USD across every settlement asset, dated by when it settled.",
    point: (bucket) => moneyPoint(bucket.net),
  },
  {
    key: "average-order",
    label: "Average order value",
    hint: "Revenue divided by orders. It tells apart more buyers from each buyer spending more.",
    point: averagePoint,
  },
  {
    key: "fees",
    label: "Fees",
    hint: "Fees split off at settlement. Mayarin never holds them.",
    point: (bucket) => moneyPoint(bucket.fees),
  },
];

export const ORDERS: readonly Definition[] = [
  {
    key: "orders",
    label: "Orders",
    hint: "Completed payments, dated by when the payment was created.",
    point: (bucket) => countPoint(bucket.orders, "order"),
  },
  {
    key: "checkouts",
    label: "Checkouts",
    hint: "Every payment intent created, paid or not.",
    point: (bucket) => countPoint(bucket.checkouts, "checkout"),
  },
  {
    key: "conversion",
    label: "Conversion rate",
    hint: "Completed orders out of checkouts created.",
    point: (bucket) => ratioPoint(bucket.orders, bucket.checkouts),
  },
  {
    key: "failed",
    label: "Failed and expired",
    hint: "Checkouts that failed or ran out of time before being paid.",
    point: (bucket) => countPoint(bucket.failed, "checkout"),
  },
  {
    key: "completion",
    label: "Time to pay",
    hint: "Median time from checkout created to payment completed.",
    point: (bucket) => durationPoint(bucket.completion),
  },
];

export const SETTLEMENTS: readonly Definition[] = [
  {
    key: "settled",
    label: "Settled volume",
    hint: "Net amount settled to you, in USD, dated by when it settled.",
    chart: "bar",
    point: (bucket) => moneyPoint(bucket.net),
  },
  {
    key: "settlements",
    label: "Settlements",
    hint: "Completed settlements.",
    point: (bucket) => countPoint(bucket.settlements, "settlement"),
  },
  {
    key: "settlement-time",
    label: "Settlement time",
    hint: "Median time from payment to settlement.",
    point: (bucket) => durationPoint(bucket.settlementTime),
  },
];

/**
 * One group of metrics over a range, with the change against the range before.
 *
 * Revenue alone is also drawn cumulatively; it is added here rather than as a
 * definition because its point is a running sum, not a bucket's own figure.
 */
export function metricsOf(
  definitions: readonly Definition[],
  input: {
    readonly payments: readonly PaymentIntentDto[];
    readonly settlements: readonly SettlementDto[];
    readonly range: Range;
    readonly interval: Interval;
    readonly rates: Readonly<Record<string, string>>;
    readonly cumulative?: boolean;
  },
): readonly Metric[] {
  const current = gather(
    input.payments,
    input.settlements,
    input.range,
    input.interval,
    input.rates,
  );
  const previous = fold(
    gather(
      input.payments,
      input.settlements,
      previousRange(input.range),
      input.interval,
      input.rates,
    ),
  );
  const whole = fold(current);

  const metrics = definitions.map((definition): Metric => {
    const figure = definition.point(whole);
    return {
      key: definition.key,
      label: definition.label,
      hint: definition.hint,
      chart: definition.chart ?? "line",
      points: [...current].map(([date, bucket]) => ({ date, ...definition.point(bucket) })),
      total: figure.display,
      change: changeOf(figure.value, definition.point(previous).value),
    };
  });

  if (input.cumulative !== true) return metrics;

  let running = 0n;
  const cumulative: Metric = {
    key: "cumulative-revenue",
    label: "Cumulative revenue",
    hint: "Revenue added up from the start of the range.",
    chart: "line",
    points: [...current].map(([date, bucket]) => {
      running += bucket.revenue;
      return { date, ...moneyPoint(running) };
    }),
    total: formatUsd(whole.revenue),
    change: changeOf(Number(whole.revenue), Number(previous.revenue)),
  };
  return [...metrics.slice(0, 2), cumulative, ...metrics.slice(2)];
}
