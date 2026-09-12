/**
 * Merchant analytics — a React island over the dedicated `/analytics` read.
 *
 * Two sections, because a payment and its settlement are two different facts
 * about the same money and a merchant asks different questions of each. **Pay
 * ins** is the gross USD value of what buyers were charged, normalized at each
 * payment's locked settlement rate so several source currencies can share one
 * chart. **Pay outs** is what actually reached the merchant, net of fee, in the
 * settlement asset. Charting one and calling it both would hide the fee and
 * every payment that was taken and never settled.
 *
 * The two sections ask different questions, because the merchant does. **Pay
 * ins** is a sales report: revenue, orders, and what an order is worth — three
 * day-by-day lines, because revenue is read as a trend. **Pay outs** is an
 * operations report: how much moved, what state it ended in, how long it took.
 * Every figure is derived from the unpaginated analytics read, so changing a
 * page in the explorer can never move a chart.
 *
 * ## Colour
 *
 * The charts are single-hue: length carries magnitude, the direct label carries
 * identity, and the hue means only "this is data". Shading by value would be
 * colour following rank, repainted the moment a sort changes.
 *
 * **Status overview and the payer mixes are deliberate exceptions.** Categories
 * share one stacked bar, so colour encodes identity rather than rank. Every
 * segment is repeated in a labelled legend with its count and share, so colour
 * is never the only signal.
 *
 * Each chart ships a real table behind a disclosure, so the numbers are
 * reachable without reading a picture.
 */

import { type AssetCode, assetDecimals, assetSymbol } from "@mayarin/shared/asset";
import { formatMoneyLocale } from "@mayarin/shared/locale";
import { money } from "@mayarin/shared/money";
import { ChartBarIcon, InfoIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { match } from "ts-pattern";
import { AssetLogo } from "@/components/asset-logo";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { dayLabel, type Plot, TrendBars, TrendChart } from "@/components/ui/trend-chart";
import { useAnalytics } from "@/hooks/analytics";
import {
  payerAssetBreakdown,
  payerCountryBreakdown,
  paymentsIn,
  type RankedInsight,
  reportingPeriods,
  settlementsIn,
  summarizePeriod,
} from "@/lib/analytics-insights";
import { payInAmountUsd, settlementsByPaymentIntent } from "@/lib/analytics-movements";
import { ApiError } from "@/lib/api/client";
import { compactMoney } from "@/lib/compact";
import { countryLabel } from "@/lib/countries";
import { ICON_CARD } from "@/lib/icons";
import { dominantAsset } from "@/lib/money";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

/**
 * The charting window, matching the overview's balance card.
 *
 * The read behind it is unpaginated — every payment and settlement, always — so
 * this slices rather than fetches. One window across the product means the
 * "View more" on the overview opens the same month it was showing, rather than
 * a different window wearing the same title.
 */
const WINDOW_DAYS = 30;

/* -------------------------------------------------------------------------- */
/* Derivation                                                                 */
/* -------------------------------------------------------------------------- */

interface DayPoint {
  readonly date: string;
  readonly volume: bigint;
  readonly count: number;
}

/** One state's share of a section, in the tone the rest of the product uses. */
interface StatusSlice {
  readonly label: string;
  readonly count: number;
  readonly tone: "success" | "warning" | "destructive" | "neutral";
}

interface DurationPoint {
  readonly date: string;
  /** Median seconds from created to completed, over the payments that day. */
  readonly seconds: number;
  readonly count: number;
}

/** A row reduced to the three things every chart here needs from it. */
interface Movement {
  readonly day: string;
  readonly amount: bigint | null;
  readonly seconds: number | null;
}

function bucketByDay(movements: readonly Movement[]): readonly DayPoint[] {
  const byDay = new Map<string, { volume: bigint; count: number }>();
  for (const movement of movements) {
    if (movement.amount === null) continue;
    const bucket = byDay.get(movement.day) ?? { volume: 0n, count: 0 };
    byDay.set(movement.day, {
      volume: bucket.volume + movement.amount,
      count: bucket.count + 1,
    });
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-WINDOW_DAYS)
    .map(([date, bucket]) => ({ date, ...bucket }));
}

/**
 * How long each day's payments took, as a median.
 *
 * A median rather than a mean, for the reason the rail chooser already uses
 * one: a single payment that sat unpaid for an hour would otherwise describe a
 * day where everything else settled in seconds.
 */
function bucketDurations(movements: readonly Movement[]): readonly DurationPoint[] {
  const byDay = new Map<string, number[]>();
  for (const movement of movements) {
    if (movement.seconds === null) continue;
    byDay.set(movement.day, [...(byDay.get(movement.day) ?? []), movement.seconds]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-WINDOW_DAYS)
    .map(([date, samples]) => ({ date, seconds: medianOf(samples), count: samples.length }));
}

function medianOf(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/** Seconds between two timestamps, or `null` when either is missing. */
function secondsBetween(from: string, to: string | null): number | null {
  if (to === null) return null;
  const elapsed = (new Date(to).getTime() - new Date(from).getTime()) / 1000;
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

/**
 * The locked USD value of what buyers were charged.
 *
 * Dated by creation rather than completion: this is demand, and a payment
 * created on Monday that settles on Tuesday was Monday's.
 */
function payInMovements(
  payments: readonly PaymentIntentDto[],
  settlements: readonly SettlementDto[],
): Movement[] {
  const byPaymentIntent = settlementsByPaymentIntent(settlements);
  return payments.map((payment) => ({
    day: payment.createdAt.slice(0, 10),
    amount: payInAmountUsd(payment, byPaymentIntent.get(payment.id)),
    seconds: secondsBetween(payment.createdAt, payment.completedAt),
  }));
}

/**
 * What reached the merchant.
 *
 * `netAmount` rather than `settlementAmount`, because the fee is not the
 * merchant's money and a payout chart that includes it overstates every day.
 * Dated by completion: this is arrival.
 */
function payOutMovements(settlements: readonly SettlementDto[], asset: AssetCode): Movement[] {
  return settlements.map((settlement) => {
    const net = settlement.netAmount;
    const settled = settlement.state === "SUCCESS" || settlement.state === "SETTLED";
    return {
      day: (settlement.completedAt ?? settlement.updatedAt).slice(0, 10),
      amount: settled && net !== null && net.asset === asset ? BigInt(net.amount) : null,
      seconds: secondsBetween(settlement.createdAt, settlement.completedAt),
    };
  });
}

const PAY_OUT_STATUS: Readonly<Record<string, { label: string; tone: StatusSlice["tone"] }>> = {
  SUCCESS: { label: "Complete", tone: "success" },
  SETTLED: { label: "Settled", tone: "success" },
  SETTLING: { label: "Settling", tone: "warning" },
  CLEARING: { label: "Clearing", tone: "warning" },
  FAILED: { label: "Failed", tone: "destructive" },
};

/**
 * Counts by state, largest first.
 *
 * A state the map does not name still appears, under its own raw name and in
 * the neutral tone. Dropping it would quietly shrink the denominator, and a
 * status overview whose shares do not add up to what happened is worse than one
 * with an unfamiliar word in it.
 */
function statusesOf(
  states: readonly string[],
  vocabulary: Readonly<Record<string, { label: string; tone: StatusSlice["tone"] }>>,
): readonly StatusSlice[] {
  const counts = new Map<string, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);

  return [...counts.entries()]
    .map(([state, count]) => {
      const known = vocabulary[state];
      return {
        label: known?.label ?? state,
        tone: known?.tone ?? ("neutral" as const),
        count,
      };
    })
    .sort((a, b) => b.count - a.count);
}

/** Whole seconds read as noise past a minute; past an hour, so do minutes. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3_600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3_600).toFixed(1)}h`;
}

/* -------------------------------------------------------------------------- */
/* Charts                                                                      */
/* -------------------------------------------------------------------------- */

const TONE_FILL: Readonly<Record<StatusSlice["tone"], string>> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  neutral: "bg-subtle-foreground",
};

const ASSET_MIX_FILLS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
  "bg-chart-7",
  "bg-chart-8",
] as const;

function assetMixFill(index: number): string {
  return ASSET_MIX_FILLS[index % ASSET_MIX_FILLS.length] ?? "bg-chart-1";
}

/**
 * Every state in one bar, with a legend that names each one.
 *
 * Not a Recharts chart: it is one bar and a list, and a charting library adds a
 * canvas, a layout pass and a tooltip to draw a row of divs.
 *
 * The bar alone would leave colour as the only channel. The legend repeats each
 * state by name, count and share, so nothing here depends on telling green from
 * yellow.
 */
function StatusOverview({ slices }: { slices: readonly StatusSlice[] }) {
  const total = slices.reduce((acc, slice) => acc + slice.count, 0);
  if (total === 0) {
    return <p className="py-14 text-center text-subtle-foreground text-xs">Nothing yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* No transform at all: it fades in rather than growing. A `scaleX`
          rasterises the bar's edges through a composited layer, and this is
          twelve pixels high — every rounding decision is a visible fraction of
          it. `shrink-0` is not cosmetic either: these widths are the data, and
          flex is otherwise entitled to shave a percentage that does not divide
          evenly. */}
      <motion.div
        aria-hidden="true"
        className="flex h-3 w-full overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {slices.map((slice) => (
          <span
            key={slice.label}
            className={cn("h-full shrink-0", TONE_FILL[slice.tone])}
            style={{ width: `${(slice.count / total) * 100}%` }}
          />
        ))}
      </motion.div>

      <ul className="flex flex-col gap-2.5">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-2">
              <span aria-hidden="true" className={cn("size-2.5 shrink-0", TONE_FILL[slice.tone])} />
              <span className="text-foreground">{slice.label}</span>
            </span>
            <span className="text-muted-foreground">
              {slice.count} · {Math.round((slice.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Part-to-whole payer mix: one stacked bar, then a legend of at most five rows. */
function PayerMix({
  rows,
  labelOf = (value) => value,
  withLogo = false,
}: {
  rows: readonly RankedInsight[];
  labelOf?: (value: string) => string;
  withLogo?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-14 text-center text-subtle-foreground text-xs">Nothing yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <motion.div
        aria-hidden="true"
        className="flex h-3 w-full overflow-hidden bg-muted"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        {rows.map((row, index) => (
          <span
            key={row.key}
            className={cn("h-full shrink-0", assetMixFill(index))}
            style={{ width: `${row.share * 100}%` }}
          />
        ))}
      </motion.div>

      <ul className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((row, index) => (
          <li key={row.key} className="flex min-w-0 items-center justify-between gap-3 text-xs">
            <span className="flex min-w-0 items-center gap-2">
              {withLogo && <AssetLogo symbol={row.key} size={20} />}
              <span aria-hidden="true" className={cn("size-2.5 shrink-0", assetMixFill(index))} />
              <span className="truncate text-foreground">{labelOf(row.key)}</span>
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {row.count} · {Math.round(row.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function comparisonChange(current: bigint | number, previous: bigint | number): string {
  if (typeof current === "bigint" && typeof previous === "bigint") {
    if (previous === 0n) return current === 0n ? "—" : "New";
    const tenths = ((current - previous) * 1_000n) / (previous < 0n ? -previous : previous);
    return `${tenths >= 0n ? "+" : ""}${Number(tenths) / 10}%`;
  }
  if (typeof current !== "number" || typeof previous !== "number") return "—";
  if (previous === 0) return current === 0 ? "—" : "New";
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function ComparisonTable({
  current,
  previous,
}: {
  current: ReturnType<typeof summarizePeriod>;
  previous: ReturnType<typeof summarizePeriod>;
}) {
  const rows = [
    {
      label: "Gross volume",
      current: formatMoneyLocale(money(current.grossUsd, "USD")),
      previous: formatMoneyLocale(money(previous.grossUsd, "USD")),
      change: comparisonChange(current.grossUsd, previous.grossUsd),
    },
    {
      label: "Completed payments",
      current: String(current.completedCount),
      previous: String(previous.completedCount),
      change: comparisonChange(current.completedCount, previous.completedCount),
    },
    {
      label: "Conversion rate",
      current: formatPercent(current.conversionRate),
      previous: formatPercent(previous.conversionRate),
      change: comparisonChange(current.conversionRate, previous.conversionRate),
    },
    {
      label: "Average transaction",
      current: formatMoneyLocale(money(current.averageUsd, "USD")),
      previous: formatMoneyLocale(money(previous.averageUsd, "USD")),
      change: comparisonChange(current.averageUsd, previous.averageUsd),
    },
    {
      label: "Median completion",
      current: formatDuration(current.completion.medianSeconds),
      previous: formatDuration(previous.completion.medianSeconds),
      change: comparisonChange(current.completion.medianSeconds, previous.completion.medianSeconds),
    },
  ];

  return (
    <Card className="gap-4">
      <CardTitle hint="The latest thirty days compared with the thirty days immediately before them.">
        Previous period comparison
      </CardTitle>
      <Table>
        <TableCaption>Current 30 days versus previous 30 days</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Metric</TableHead>
            <TableHead className="text-right">Current</TableHead>
            <TableHead className="text-right">Previous</TableHead>
            <TableHead className="text-right">Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">{row.current}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {row.previous}
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.change}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A chart's numbers, reachable without reading the picture.
 *
 * Capped and scrolled rather than allowed to run. Fourteen rows opened in one
 * card makes three cards in a row three different heights, and the section
 * below it moves down the page every time somebody opens one. The cap is a
 * little over five rows, so it is visibly a window onto more rather than a
 * table that happens to fit.
 */
function DataDisclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="w-fit cursor-pointer list-none text-muted-foreground text-xs underline decoration-input underline-offset-2 hover:text-foreground">
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

/**
 * A card's title, with the explanation behind an icon rather than under it.
 *
 * Three cards in a row have no space for a sentence each, and the sentence is
 * what makes the difference between "volume" and "volume of what, dated when".
 * The tooltip opens on focus as well as hover, so the explanation is not
 * mouse-only.
 */
function CardTitle({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <h3 className="flex items-center gap-1.5 font-medium text-foreground text-sm">
      {children}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={hint}
                className="cursor-help text-subtle-foreground transition-colors hover:text-foreground"
              >
                <InfoIcon size={14} weight="regular" aria-hidden="true" />
              </button>
            }
          />
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </h3>
  );
}

/**
 * Money, plotted.
 *
 * The Y axis is formatted from the plotted float; the tooltip is formatted from
 * the exact `bigint`. That split is the point — the axis is a ruler and a
 * rounded ruler is fine, while the figure a merchant reads off the tooltip has
 * to be the one in the ledger.
 */
function volumePlots(points: readonly DayPoint[], asset: AssetCode): readonly Plot[] {
  return points.map((point) => ({
    date: point.date,
    value: Number(point.volume),
    label: formatMoneyLocale(money(point.volume, asset)),
    detail: `${point.count} payment${point.count === 1 ? "" : "s"}`,
  }));
}

function durationPlots(points: readonly DurationPoint[]): readonly Plot[] {
  return points.map((point) => ({
    date: point.date,
    value: point.seconds,
    label: formatDuration(point.seconds),
    detail: `median over ${point.count} payment${point.count === 1 ? "" : "s"}`,
  }));
}

/**
 * Pay ins, as the three questions a merchant actually asks of a sales month:
 * how much came in, how many orders it took, and what an order is worth.
 *
 * Lines rather than columns here, against the rule the pay-out chart follows.
 * Revenue, order count and their ratio are read for their trend — is this month
 * climbing — and a line is what a trend is read off. The pay-out chart stays
 * bars, where each day is a discrete arrival rather than a level.
 *
 * All three derive from one bucketing pass, so revenue, orders and their
 * average can never disagree about the same day.
 */
function PayInsSection({ daily }: { daily: readonly DayPoint[] }) {
  const usdSymbol = assetSymbol("USD") ?? "USD";
  const usdDecimals = assetDecimals("USD");
  const formatUsdTick = (value: number) =>
    compactMoney(BigInt(Math.round(value)), usdDecimals, usdSymbol);
  const formatCountTick = (value: number) => String(Math.round(value));
  const usd = (amount: bigint) => formatMoneyLocale(money(amount, "USD"));
  const orders = (count: number) => `${count} order${count === 1 ? "" : "s"}`;

  // Integer division on minor units: an average order value is money, and a
  // float average of two dollar figures is a rounding error waiting to be
  // charted.
  const averageOf = (point: DayPoint) =>
    point.count === 0 ? 0n : point.volume / BigInt(point.count);

  const revenuePoints: readonly Plot[] = daily.map((point) => ({
    date: point.date,
    value: Number(point.volume),
    label: usd(point.volume),
    detail: orders(point.count),
  }));
  const orderPoints: readonly Plot[] = daily.map((point) => ({
    date: point.date,
    value: point.count,
    label: orders(point.count),
    detail: usd(point.volume),
  }));
  const averagePoints: readonly Plot[] = daily.map((point) => ({
    date: point.date,
    value: Number(averageOf(point)),
    label: usd(averageOf(point)),
    detail: `${usd(point.volume)} over ${orders(point.count)}`,
  }));

  const totalOrders = daily.reduce((sum, point) => sum + point.count, 0);
  const totalRevenue = daily.reduce((sum, point) => sum + point.volume, 0n);
  const periodAverage = totalOrders === 0 ? 0n : totalRevenue / BigInt(totalOrders);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title="Pay ins" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-4">
          <CardTitle hint="Gross USD value at each payment's locked settlement rate, dated by when the payment was created.">
            Revenue · USD
          </CardTitle>
          <TrendChart points={revenuePoints} formatTick={formatUsdTick} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {usd(totalRevenue)} over the last thirty days
          </p>
          <DataDisclosure summary="Show the numbers">
            <Table containerClassName="max-h-64 overflow-y-auto">
              <TableCaption>Revenue by day</TableCaption>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.map((point) => (
                  <TableRow key={point.date}>
                    <TableCell>{dayLabel(point.date)}</TableCell>
                    <TableCell className="text-right">{usd(point.volume)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {point.count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataDisclosure>
        </Card>

        <Card className="gap-4">
          <CardTitle hint="Completed orders per day. An order counts on the day its payment was created, so it sits in the same day as the revenue it produced.">
            Orders
          </CardTitle>
          <TrendChart points={orderPoints} formatTick={formatCountTick} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {orders(totalOrders)} over the last thirty days
          </p>
          <DataDisclosure summary="Show the numbers">
            <Table containerClassName="max-h-64 overflow-y-auto">
              <TableCaption>Orders by day</TableCaption>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.map((point) => (
                  <TableRow key={point.date}>
                    <TableCell>{dayLabel(point.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">{point.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataDisclosure>
        </Card>

        <Card className="gap-4">
          <CardTitle hint="Revenue divided by orders, per day. Revenue can climb because more people bought or because each of them spent more, and this is the card that tells those two apart.">
            Average order value · USD
          </CardTitle>
          <TrendChart points={averagePoints} formatTick={formatUsdTick} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {usd(periodAverage)} across the whole period
          </p>
          <DataDisclosure summary="Show the numbers">
            <Table containerClassName="max-h-64 overflow-y-auto">
              <TableCaption>Average order value by day</TableCaption>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Average</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.map((point) => (
                  <TableRow key={point.date}>
                    <TableCell>{dayLabel(point.date)}</TableCell>
                    <TableCell className="text-right">{usd(averageOf(point))}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {point.count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataDisclosure>
        </Card>
      </div>
    </section>
  );
}

/** One section: how much moved, how it ended, how long it took. */
function MovementSection({
  title,
  asset,
  daily,
  statuses,
  durations,
  volumeHint,
  statusHint,
  durationHint,
  durationSummary,
}: {
  title: string;
  asset: AssetCode;
  daily: readonly DayPoint[];
  statuses: readonly StatusSlice[];
  durations: readonly DurationPoint[];
  volumeHint: string;
  statusHint: string;
  durationHint: string;
  durationSummary?: string;
}) {
  const decimals = assetDecimals(asset);
  const symbol = assetSymbol(asset) ?? asset;
  // Minor units back to a `bigint` for the axis label, which is the only place
  // a plotted float meets the money formatter.
  const formatMoneyTick = (value: number) =>
    compactMoney(BigInt(Math.round(value)), decimals, symbol);

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={title} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-4">
          <CardTitle hint={volumeHint}>Transaction volume · {asset}</CardTitle>
          {/* Bars: a day's takings are a discrete quantity, and a line
              between two of them draws a value that never existed. Completion
              time stays a line — a median is a level, and it does hold
              between two readings. */}
          <TrendBars points={volumePlots(daily, asset)} formatTick={formatMoneyTick} />
          <DataDisclosure summary="Show the numbers">
            <Table containerClassName="max-h-64 overflow-y-auto">
              <TableCaption>Volume by day</TableCaption>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {daily.map((point) => (
                  <TableRow key={point.date}>
                    <TableCell>{dayLabel(point.date)}</TableCell>
                    <TableCell className="text-right">
                      {formatMoneyLocale(money(point.volume, asset))}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {point.count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataDisclosure>
        </Card>

        <Card className="gap-4">
          <CardTitle hint={statusHint}>Status overview</CardTitle>
          <StatusOverview slices={statuses} />
        </Card>

        <Card className="gap-4">
          <CardTitle hint={durationHint}>Completion time</CardTitle>
          <TrendChart points={durationPlots(durations)} formatTick={formatDuration} />
          {durationSummary !== undefined && (
            <p className="text-xs text-muted-foreground tabular-nums">{durationSummary}</p>
          )}
          <DataDisclosure summary="Show the numbers">
            <Table containerClassName="max-h-64 overflow-y-auto">
              <TableCaption>Median completion time by day</TableCaption>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Day</TableHead>
                  <TableHead className="text-right">Median</TableHead>
                  <TableHead className="text-right">Payments</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {durations.map((point) => (
                  <TableRow key={point.date}>
                    <TableCell>{dayLabel(point.date)}</TableCell>
                    <TableCell className="text-right">{formatDuration(point.seconds)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {point.count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataDisclosure>
        </Card>
      </div>
    </section>
  );
}

function Analytics() {
  const analytics = useAnalytics();

  return match(analytics)
    .with({ status: "pending" }, () => (
      <PageLoader label="Loading analytics" className="min-h-128" />
    ))
    .with({ status: "error" }, ({ error }) => (
      <QueryError
        message={error instanceof ApiError ? error.message : "Failed to load analytics"}
        retry={() => void analytics.refetch()}
        retrying={analytics.isFetching}
      />
    ))
    .with({ status: "success" }, ({ data }) => {
      const payments = data.payments;
      const settlements = data.settlements;
      const periods = reportingPeriods(new Date());
      const currentPayments = paymentsIn(payments, periods.current);
      const previousPayments = paymentsIn(payments, periods.previous);
      const currentSettlements = settlementsIn(settlements, periods.current);
      const previousSettlements = settlementsIn(settlements, periods.previous);
      const currentInsight = summarizePeriod(currentPayments, settlements);
      const previousInsight = summarizePeriod(previousPayments, settlements);

      const settledAmounts = settlements
        .filter((row) => row.state === "SUCCESS" || row.state === "SETTLED")
        .map((row) => row.netAmount)
        .filter((amount) => amount !== null);
      const payOutAsset = dominantAsset(settledAmounts);
      const payIns = payInMovements(currentPayments, settlements);

      if (payments.length === 0) {
        return (
          <div className="flex flex-col gap-8">
            <StatGrid>
              <Stat label="Payments" value={String(payments.length)} hint="Across all payments." />
              <Stat label="Completed" value="0" hint="Nothing to chart yet." />
              <Stat label="Volume" value="—" hint="No completed payments." />
              <Stat label="Busiest day" value="—" hint="No completed payments." />
            </StatGrid>
            <Empty>
              <EmptyMedia>
                <ChartBarIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Charts appear after the first completed payment.</EmptyTitle>
              <EmptyDescription>
                Take a payment to begin tracking volume and settlement.
              </EmptyDescription>
              <EmptyAction>
                <a href="/links" className={buttonVariants()}>
                  Take your first payment
                </a>
              </EmptyAction>
            </Empty>
          </div>
        );
      }

      const payOuts =
        payOutAsset === undefined ? [] : payOutMovements(currentSettlements, payOutAsset);
      const payInDaily = bucketByDay(payIns);
      const payOutDaily = bucketByDay(payOuts);
      const settledIn = currentSettlements
        .filter((row) => row.state === "SUCCESS" || row.state === "SETTLED")
        .map((row) => row.netAmount)
        .flatMap((amount) => (amount !== null && amount.asset === payOutAsset ? [amount] : []));
      const totalVolume = settledIn.reduce((acc, amount) => acc + BigInt(amount.amount), 0n);
      const totalFees = currentSettlements
        .filter((row) => row.state === "SUCCESS" || row.state === "SETTLED")
        .map((row) => row.fee)
        .flatMap((amount) => (amount !== null && amount.asset === payOutAsset ? [amount] : []))
        .reduce((sum, amount) => sum + BigInt(amount.amount), 0n);
      const payout = (amount: bigint) =>
        payOutAsset === undefined
          ? "—"
          : formatMoneyLocale(money(amount, payOutAsset), { trimZeroFraction: true });
      const assetMix = payerAssetBreakdown(currentPayments);
      const countryMix = payerCountryBreakdown(currentPayments);
      const previousNet = previousSettlements
        .filter((row) => row.state === "SUCCESS" || row.state === "SETTLED")
        .map((row) => row.netAmount)
        .flatMap((amount) => (amount !== null && amount.asset === payOutAsset ? [amount] : []))
        .reduce((sum, amount) => sum + BigInt(amount.amount), 0n);

      // Keep the net comparison visible in the headline hint without mixing
      // settlement-asset minor units into the USD comparison table.
      const netChange = comparisonChange(totalVolume, previousNet);

      return (
        <div className="flex flex-col gap-8">
          <StatGrid className="xl:grid-cols-5">
            <Stat
              label="Gross volume · USD"
              value={formatMoneyLocale(money(currentInsight.grossUsd, "USD"), {
                trimZeroFraction: true,
              })}
              hint={`Before fees, across ${currentInsight.completedCount} completed payment${currentInsight.completedCount === 1 ? "" : "s"}.`}
            />
            <Stat
              label={payOutAsset === undefined ? "Net settled" : `Net settled · ${payOutAsset}`}
              value={payout(totalVolume)}
              hint={`${netChange} versus the previous thirty days.`}
            />
            <Stat
              label={payOutAsset === undefined ? "Fees" : `Fees · ${payOutAsset}`}
              value={payout(totalFees)}
              hint="Fees on completed settlements."
            />
            <Stat
              label="Conversion rate"
              value={formatPercent(currentInsight.conversionRate)}
              hint={`${currentInsight.completedCount} of ${currentInsight.paymentCount} payment intents completed.`}
            />
            <Stat
              label="Average transaction · USD"
              value={formatMoneyLocale(money(currentInsight.averageUsd, "USD"), {
                trimZeroFraction: true,
              })}
              hint="Gross USD volume divided by completed payments."
            />
          </StatGrid>

          <PayInsSection daily={payInDaily} />

          {payOutAsset !== undefined && (
            <MovementSection
              title="Pay outs"
              asset={payOutAsset}
              daily={payOutDaily}
              statuses={statusesOf(
                currentSettlements.map((settlement) => settlement.state),
                PAY_OUT_STATUS,
              )}
              durations={bucketDurations(payOuts)}
              volumeHint="What reached you, net of fee, dated by when it settled."
              statusHint="Settlements completed or updated in the last thirty days, by current state."
              durationHint="Median time from payment to settlement, per day."
            />
          )}

          <section className="flex flex-col gap-3">
            <SectionHeader title="Payment mix" />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="gap-4">
                <CardTitle hint="Assets buyers used for completed payments in the current period.">
                  Payer assets
                </CardTitle>
                <PayerMix rows={assetMix} withLogo />
              </Card>
              <Card className="gap-4">
                <CardTitle hint="Country captured at checkout. Older payments without country metadata remain Unknown.">
                  Payer countries
                </CardTitle>
                <PayerMix
                  rows={countryMix}
                  labelOf={(value) =>
                    value === "Unknown" || value === "Others" ? value : countryLabel(value)
                  }
                />
              </Card>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader title="Period comparison" />
            <ComparisonTable current={currentInsight} previous={previousInsight} />
          </section>
        </div>
      );
    })
    .exhaustive();
}

export default withQuery(Analytics);
