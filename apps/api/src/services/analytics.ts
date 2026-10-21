/**
 * Merchant analytics: the dashboard's Analytics figures, computed here so an
 * integration reads the same numbers.
 *
 * Pay ins are dated by creation (an order belongs to the day it was placed),
 * pay outs by arrival, and every bucket in the range is present, empty ones
 * included. `buildAnalytics` is pure over what was read; `AnalyticsService`
 * only reads.
 */

import type { ClearingTransaction } from "@mayarin/clearing";
import {
  isExpired,
  type PaymentIntent,
  type PaymentIntentRepository,
} from "@mayarin/payment-intent";
import {
  assetDecimals,
  type Clock,
  isAssetCode,
  type Money,
  PAYER_COUNTRY_METADATA_KEY,
} from "@mayarin/shared";
import {
  ANALYTICS_METRICS,
  type AnalyticsDto,
  type AnalyticsInterval,
  type AnalyticsMetricDto,
  type AnalyticsMetricKey,
  type AnalyticsPerformanceDto,
  type AnalyticsQuery,
  type AnalyticsShareDto,
  type AnalyticsUnit,
} from "../dto/analytics.ts";

/** The slice of `ClearingRepository` analytics reads. */
export interface AnalyticsClearingReader {
  listByPaymentIntentIds(ids: readonly string[]): Promise<readonly ClearingTransaction[]>;
}

const DAY_MS = 86_400_000;
const PAGE_SIZE = 200;
/** Stablecoins that are a dollar in another representation: valued 1:1. */
const DOLLAR_ASSETS: ReadonlySet<string> = new Set(["USDC", "USDT", "USDG", "PYUSD"]);

interface Range {
  readonly from: string;
  readonly to: string;
}

/* -------------------------------------------------------------------------- */
/* Days and buckets                                                            */
/* -------------------------------------------------------------------------- */

const dayKey = (time: number): string => new Date(time).toISOString().slice(0, 10);
const timeOf = (key: string): number => Date.parse(`${key}T00:00:00Z`);

/** The first day of the bucket a day falls in. Weeks start on Monday. */
function bucketOf(day: string, interval: AnalyticsInterval): string {
  if (interval === "day") return day;
  if (interval === "month") return `${day.slice(0, 7)}-01`;
  const time = timeOf(day);
  const sinceMonday = (new Date(time).getUTCDay() + 6) % 7;
  return dayKey(time - sinceMonday * DAY_MS);
}

function bucketsOf(range: Range, interval: AnalyticsInterval): readonly string[] {
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
function previousRange(range: Range): Range {
  const length = (timeOf(range.to) - timeOf(range.from)) / DAY_MS + 1;
  const to = timeOf(range.from) - DAY_MS;
  return { from: dayKey(to - (length - 1) * DAY_MS), to: dayKey(to) };
}

/** `from` and `to` as given, else the 30 days ending today. */
export function rangeOf(query: Pick<AnalyticsQuery, "from" | "to">, now: Date): Range {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const to = query.to ?? dayKey(today);
  return { from: query.from ?? dayKey(timeOf(to) - 29 * DAY_MS), to };
}

const inRange = (time: Date, range: Range): boolean =>
  time.getTime() >= timeOf(range.from) && time.getTime() < timeOf(range.to) + DAY_MS;

/* -------------------------------------------------------------------------- */
/* Facts                                                                       */
/* -------------------------------------------------------------------------- */

const isSettled = (tx: ClearingTransaction): boolean =>
  tx.state === "SUCCESS" || tx.state === "SETTLED";

const seconds = (from: Date, to: Date | undefined): number | undefined => {
  if (to === undefined) return undefined;
  const elapsed = (to.getTime() - from.getTime()) / 1000;
  return elapsed >= 0 ? elapsed : undefined;
};

function median(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/** Nearest rank: the wait nine payers in ten stayed under. */
function p90(samples: readonly number[]): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.9) - 1] ?? null;
}

/** A dollar stablecoin amount in USD cents; `null` for anything else, so it is left out. */
function dollarCents(money: Money | undefined): bigint | null {
  if (money === undefined || !isAssetCode(money.asset) || !DOLLAR_ASSETS.has(money.asset)) {
    return null;
  }
  const shift = assetDecimals(money.asset) - assetDecimals("USD");
  if (shift <= 0) return money.amount * 10n ** BigInt(-shift);
  const divisor = 10n ** BigInt(shift);
  return (money.amount + divisor / 2n) / divisor;
}

/**
 * A completed payment in USD cents. A USD price is exact; any other price uses
 * the gross dollar amount locked for that payment. `null` when neither exists.
 */
function revenueCents(intent: PaymentIntent, tx: ClearingTransaction | undefined): bigint | null {
  if (intent.amount.asset === "USD") return intent.amount.amount;
  if (tx === undefined || !isSettled(tx)) return null;
  return dollarCents(tx.settlementAmount);
}

const settledAt = (intent: PaymentIntent, tx: ClearingTransaction): Date =>
  intent.completedAt ?? tx.updatedAt;

/* -------------------------------------------------------------------------- */
/* Buckets                                                                     */
/* -------------------------------------------------------------------------- */

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

const emptyBucket = (): Bucket => ({
  revenue: 0n,
  orders: 0,
  checkouts: 0,
  failed: 0,
  completion: [],
  net: 0n,
  fees: 0n,
  settlements: 0,
  settlementTime: [],
});

function gather(
  payments: readonly PaymentIntent[],
  byIntent: ReadonlyMap<string, ClearingTransaction>,
  range: Range,
  interval: AnalyticsInterval,
): ReadonlyMap<string, Bucket> {
  const buckets = new Map(bucketsOf(range, interval).map((key) => [key, emptyBucket()]));

  for (const intent of payments) {
    if (!inRange(intent.createdAt, range)) continue;
    const bucket = buckets.get(bucketOf(dayKey(intent.createdAt.getTime()), interval));
    if (bucket === undefined) continue;
    bucket.checkouts += 1;
    if (intent.status === "FAILED" || intent.status === "EXPIRED") bucket.failed += 1;
    if (intent.status !== "COMPLETED") continue;
    bucket.orders += 1;
    bucket.revenue += revenueCents(intent, byIntent.get(intent.id)) ?? 0n;
    const elapsed = seconds(intent.createdAt, intent.completedAt);
    if (elapsed !== undefined) bucket.completion.push(elapsed);
  }

  for (const intent of payments) {
    const tx = byIntent.get(intent.id);
    if (tx === undefined || !isSettled(tx)) continue;
    const arrived = settledAt(intent, tx);
    if (!inRange(arrived, range)) continue;
    const bucket = buckets.get(bucketOf(dayKey(arrived.getTime()), interval));
    if (bucket === undefined) continue;
    bucket.settlements += 1;
    bucket.net += dollarCents(tx.netAmount) ?? 0n;
    bucket.fees += dollarCents(tx.fee) ?? 0n;
    const elapsed = seconds(tx.createdAt, intent.completedAt);
    if (elapsed !== undefined) bucket.settlementTime.push(elapsed);
  }

  return buckets;
}

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

/* -------------------------------------------------------------------------- */
/* Metrics                                                                     */
/* -------------------------------------------------------------------------- */

interface Definition {
  readonly label: string;
  readonly unit: AnalyticsUnit;
  readonly value: (bucket: Bucket) => number | null;
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

const DEFINITIONS: Readonly<Record<AnalyticsMetricKey, Definition>> = {
  revenue: {
    label: "Revenue",
    unit: "usd_cents",
    value: (b) => Number(b.revenue),
  },
  net_revenue: { label: "Net revenue", unit: "usd_cents", value: (b) => Number(b.net) },
  average_order_value: {
    label: "Average order value",
    unit: "usd_cents",
    value: (b) => (b.orders === 0 ? 0 : Number(b.revenue / BigInt(b.orders))),
  },
  fees: { label: "Fees", unit: "usd_cents", value: (b) => Number(b.fees) },
  orders: { label: "Orders", unit: "count", value: (b) => b.orders },
  checkouts: { label: "Checkouts", unit: "count", value: (b) => b.checkouts },
  conversion_rate: {
    label: "Conversion rate",
    unit: "ratio",
    value: (b) => ratio(b.orders, b.checkouts),
  },
  failed_checkouts: { label: "Failed and expired", unit: "count", value: (b) => b.failed },
  time_to_pay: { label: "Time to pay", unit: "seconds", value: (b) => median(b.completion) },
  time_to_pay_p90: {
    label: "Time to pay (p90)",
    unit: "seconds",
    value: (b) => p90(b.completion),
  },
  success_rate: {
    label: "Success rate",
    unit: "ratio",
    value: (b) => ratio(b.orders, b.orders + b.failed),
  },
  settled_volume: { label: "Settled volume", unit: "usd_cents", value: (b) => Number(b.net) },
  settlements: { label: "Settlements", unit: "count", value: (b) => b.settlements },
  settlement_time: {
    label: "Settlement time",
    unit: "seconds",
    value: (b) => median(b.settlementTime),
  },
};

function changeOf(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/* -------------------------------------------------------------------------- */
/* Breakdowns                                                                  */
/* -------------------------------------------------------------------------- */

function shares(keys: readonly string[]): readonly AnalyticsShareDto[] {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts]
    .map(([key, count]) => ({ key, count, share: count / keys.length }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function performanceBy(
  payments: readonly PaymentIntent[],
  keyOf: (intent: PaymentIntent) => string,
): readonly AnalyticsPerformanceDto[] {
  const groups = new Map<string, { ok: number; bad: number; seconds: number[] }>();
  for (const intent of payments) {
    const done = intent.status === "COMPLETED";
    if (!done && intent.status !== "FAILED" && intent.status !== "EXPIRED") continue;
    const key = keyOf(intent);
    const group = groups.get(key) ?? { ok: 0, bad: 0, seconds: [] };
    if (done) {
      group.ok += 1;
      const elapsed = seconds(intent.createdAt, intent.completedAt);
      if (elapsed !== undefined) group.seconds.push(elapsed);
    } else group.bad += 1;
    groups.set(key, group);
  }
  return [...groups]
    .map(([key, group]) => ({
      key,
      finished: group.ok + group.bad,
      successRate: group.ok / (group.ok + group.bad),
      medianSeconds: median(group.seconds),
    }))
    .sort((a, b) => b.finished - a.finished || a.key.localeCompare(b.key));
}

function payerCountry(intent: PaymentIntent): string {
  const value = intent.metadata[PAYER_COUNTRY_METADATA_KEY]?.trim().toUpperCase();
  return value !== undefined && /^[A-Z]{2}$/.test(value) ? value : "Unknown";
}

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

export interface AnalyticsInput {
  /** Every payment of the merchant, expiry already applied. */
  readonly payments: readonly PaymentIntent[];
  readonly clearing: readonly ClearingTransaction[];
  readonly query: AnalyticsQuery;
  readonly now: Date;
}

export function buildAnalytics({ payments, clearing, query, now }: AnalyticsInput): AnalyticsDto {
  const range = rangeOf(query, now);
  const { interval } = query;
  const filtered = payments.filter(
    (intent) =>
      (query.chain === undefined || intent.payment?.chain === query.chain) &&
      (query.asset === undefined || intent.payment?.asset === query.asset),
  );
  const byIntent = new Map(clearing.map((tx) => [tx.paymentIntentId, tx]));

  const current = gather(filtered, byIntent, range, interval);
  const previous = fold(gather(filtered, byIntent, previousRange(range), interval));
  const whole = fold(current);

  const keys = query.metrics ?? ANALYTICS_METRICS;
  const metrics = keys.map((key): AnalyticsMetricDto => {
    const { label, unit, value } = DEFINITIONS[key as AnalyticsMetricKey];
    const total = value(whole);
    return {
      key: key as AnalyticsMetricKey,
      label,
      unit,
      total,
      change: changeOf(total, value(previous)),
      points: [...current].map(([date, bucket]) => ({ date, value: value(bucket) })),
    };
  });

  const inWindow = filtered.filter((intent) => inRange(intent.createdAt, range));
  const completed = inWindow.filter((intent) => intent.status === "COMPLETED");
  return {
    currency: "USD",
    range,
    interval,
    metrics,
    breakdowns: {
      networks: shares(completed.map((intent) => intent.payment?.chain ?? "Unknown")),
      assets: shares(completed.map((intent) => intent.payment?.asset ?? "Unknown")),
      countries: shares(completed.map(payerCountry)),
    },
    performance: {
      networks: performanceBy(inWindow, (intent) => intent.payment?.chain ?? "Unknown"),
      assets: performanceBy(inWindow, (intent) => intent.payment?.asset ?? "Unknown"),
    },
  };
}

export class AnalyticsService {
  readonly #intents: PaymentIntentRepository;
  readonly #clearing: AnalyticsClearingReader;
  readonly #clock: Clock;

  constructor(options: {
    readonly intents: PaymentIntentRepository;
    readonly clearing: AnalyticsClearingReader;
    readonly clock: Clock;
  }) {
    this.#intents = options.intents;
    this.#clearing = options.clearing;
    this.#clock = options.clock;
  }

  /** The merchant's own analytics. Reads every payment, as the dashboard does. */
  async report(merchantId: string, query: AnalyticsQuery): Promise<AnalyticsDto> {
    const now = this.#clock.now();
    const payments: PaymentIntent[] = [];
    let cursor: { id: string; createdAt: Date } | undefined;
    for (;;) {
      const page = await this.#intents.list({
        merchantId,
        limit: PAGE_SIZE,
        ...(cursor === undefined ? {} : { cursor }),
      });
      payments.push(...page);
      const last = page.at(-1);
      if (page.length < PAGE_SIZE || last === undefined) break;
      cursor = { id: last.id, createdAt: last.createdAt };
    }

    // A pending intent past its expiry reads as expired, as it does on the dashboard.
    const viewed = payments.map((intent) =>
      isExpired(intent, now) ? { ...intent, status: "EXPIRED" as const } : intent,
    );
    const clearing = await this.#clearing.listByPaymentIntentIds(viewed.map((intent) => intent.id));
    return buildAnalytics({ payments: viewed, clearing, query, now });
  }
}
