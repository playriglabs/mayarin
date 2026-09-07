/**
 * Merchant analytics — a React island over the dedicated `/analytics` read.
 *
 * Two sections, because a payment and its settlement are two different facts
 * about the same money and a merchant asks different questions of each. **Pay
 * ins** is what buyers were charged, in the merchant's own currency. **Pay
 * outs** is what actually reached the merchant, net of fee, in the settlement
 * asset. Charting one and calling it both would hide the fee and every payment
 * that was taken and never settled.
 *
 * Each section answers the same three questions: how much moved, what state it
 * ended in, and how long it took. Every figure is derived from the unpaginated
 * analytics read, so changing a page in the explorer can never move a chart.
 *
 * ## Colour
 *
 * The charts are single-hue: length carries magnitude, the direct label carries
 * identity, and the hue means only "this is data". Shading by value would be
 * colour following rank, repainted the moment a sort changes.
 *
 * **Status overview is the one deliberate exception.** Four states share one
 * stacked bar, so length cannot distinguish them — colour is the only channel
 * left, and it is encoding identity rather than rank. It uses the semantic
 * tokens the rest of the product already reads (`success`, `warning`,
 * `destructive`, and a muted grey for expired), so a status means the same
 * thing here as it does on a payment row. Every segment is also labelled with
 * its name and its share, so the colour is never the only signal.
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
import { dayLabel, type Plot, TrendChart } from "@/components/ui/trend-chart";
import { useAnalytics } from "@/hooks/analytics";
import { ApiError } from "@/lib/api/client";
import { compactMoney } from "@/lib/compact";
import { ICON_CARD } from "@/lib/icons";
import { dominantAsset } from "@/lib/money";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

const WINDOW_DAYS = 14;

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
 * What buyers were charged.
 *
 * Dated by creation rather than completion: this is demand, and a payment
 * created on Monday that settles on Tuesday was Monday's.
 */
function payInMovements(payments: readonly PaymentIntentDto[], asset: AssetCode): Movement[] {
  return payments.map((payment) => ({
    day: payment.createdAt.slice(0, 10),
    amount:
      payment.status === "COMPLETED" && payment.amount.asset === asset
        ? BigInt(payment.amount.amount)
        : null,
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

const PAY_IN_STATUS: Readonly<Record<string, { label: string; tone: StatusSlice["tone"] }>> = {
  COMPLETED: { label: "Completed", tone: "success" },
  CREATED: { label: "Awaiting payment", tone: "warning" },
  CONFIRMED: { label: "Confirmed", tone: "warning" },
  PROCESSING: { label: "Processing", tone: "warning" },
  FAILED: { label: "Failed", tone: "destructive" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

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
}: {
  title: string;
  asset: AssetCode;
  daily: readonly DayPoint[];
  statuses: readonly StatusSlice[];
  durations: readonly DurationPoint[];
  volumeHint: string;
  statusHint: string;
  durationHint: string;
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
          <TrendChart points={volumePlots(daily, asset)} formatTick={formatMoneyTick} />
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

      const settledAmounts = settlements
        .filter((row) => row.state === "SUCCESS" || row.state === "SETTLED")
        .map((row) => row.netAmount)
        .filter((amount) => amount !== null);
      const payOutAsset = dominantAsset(settledAmounts);
      // Priced in the merchant's own currency, which is a different question
      // from what they settled in — an IDR merchant settling USDC has two.
      const payInAsset = dominantAsset(
        payments.filter((p) => p.status === "COMPLETED").map((p) => p.amount),
      );

      if (payOutAsset === undefined || payInAsset === undefined) {
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

      const payIns = payInMovements(payments, payInAsset);
      const payOuts = payOutMovements(settlements, payOutAsset);
      const payInDaily = bucketByDay(payIns);
      const payOutDaily = bucketByDay(payOuts);

      const settledIn = settledAmounts.filter((amount) => amount.asset === payOutAsset);
      const totalVolume = settledIn.reduce((acc, amount) => acc + BigInt(amount.amount), 0n);
      const totalCount = settledIn.length;
      const average = totalCount === 0 ? 0n : totalVolume / BigInt(totalCount);
      // `reduce` with no seed throws on an empty array, and a seed of
      // `payOutDaily[0]` is `undefined` to the compiler for exactly that case.
      const busiest = payOutDaily.reduce<DayPoint | undefined>(
        (acc, point) => (acc === undefined || point.volume > acc.volume ? point : acc),
        undefined,
      );

      return (
        <div className="flex flex-col gap-8">
          <StatGrid>
            <Stat
              label={`Settled volume · ${payOutAsset}`}
              value={formatMoneyLocale(money(totalVolume, payOutAsset), { trimZeroFraction: true })}
              hint={`Net of fee, across ${totalCount} completed payment${totalCount === 1 ? "" : "s"}.`}
            />
            <Stat label="Payments" value={String(payments.length)} hint="Across all payments." />
            <Stat
              label={`Average settlement · ${payOutAsset}`}
              value={formatMoneyLocale(money(average, payOutAsset), { trimZeroFraction: true })}
              hint="Net settled volume divided by completed settlements."
            />
            <Stat
              label="Busiest day"
              value={busiest === undefined ? "—" : dayLabel(busiest.date)}
              hint={
                busiest === undefined
                  ? "No completed payments."
                  : `${busiest.count} payment${busiest.count === 1 ? "" : "s"}.`
              }
            />
          </StatGrid>

          <MovementSection
            title="Pay ins"
            asset={payInAsset}
            daily={payInDaily}
            statuses={statusesOf(
              payments.map((payment) => payment.status),
              PAY_IN_STATUS,
            )}
            durations={bucketDurations(payIns)}
            volumeHint="What buyers were charged, dated by when the payment was created."
            statusHint="Every payment intent by the state it is in now, including the ones nobody paid."
            durationHint="Median time from created to completed, per day."
          />

          <MovementSection
            title="Pay outs"
            asset={payOutAsset}
            daily={payOutDaily}
            statuses={statusesOf(
              settlements.map((settlement) => settlement.state),
              PAY_OUT_STATUS,
            )}
            durations={bucketDurations(payOuts)}
            volumeHint="What reached you, net of fee, dated by when it settled."
            statusHint="Every settlement by clearing state. A payment nobody made never reaches this chart."
            durationHint="Median time from payment to settlement, per day."
          />
        </div>
      );
    })
    .exhaustive();
}

export default withQuery(Analytics);
