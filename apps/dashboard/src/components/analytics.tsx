/**
 * Merchant analytics — a React island over the real `/payments` endpoint.
 *
 * Every figure is derived from the same page the explorer reads, so the
 * numbers can never disagree with the list behind them. There is no analytics
 * endpoint yet; when one lands (pre-aggregated, unwindowed), it replaces the
 * derivation here and the charts stay as they are. Until then the window is
 * stated honestly: the most recent 100 payments.
 *
 * Volume is charted for ONE asset — the one most completed payments are
 * priced in — because adding two currencies without a rate would be a lie the
 * ledger would not recognise.
 *
 * Two charts, both single-series, both drawn in one hue. Shading bars
 * light-to-dark by value would be colour following RANK rather than an
 * entity: redundant with the length already encoding magnitude, and repainted
 * the moment the sort changes. Length carries magnitude; the direct label
 * carries identity; the hue is constant and means only "this is data".
 * Marks are square-ended because the design system has no corner radius.
 *
 * Each chart ships a real table behind a disclosure, so the numbers are
 * reachable without reading a picture.
 */

import { type AssetCode, assetDecimals, assetSymbol } from "@mayarin/shared/asset";
import { formatMoneyLocale } from "@mayarin/shared/locale";
import { money } from "@mayarin/shared/money";
import { ChartBarIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SectionHeader } from "@/components/ui/section-header";
import { PanelSkeleton, StatGridSkeleton } from "@/components/ui/skeleton";
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
import { usePayments } from "@/hooks/payments";
import { ApiError } from "@/lib/api/client";
import { compactMoney, percentOf } from "@/lib/compact";
import { ICON_CARD } from "@/lib/icons";
import { dominantAsset } from "@/lib/money";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type { PaymentIntentDto } from "@/types/payment";

const DAY_LABEL = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short" });

function dayLabel(iso: string): string {
  return DAY_LABEL.format(new Date(`${iso}T00:00:00Z`));
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                 */
/* -------------------------------------------------------------------------- */

interface DayPoint {
  readonly date: string;
  readonly volume: bigint;
  readonly count: number;
}

interface AssetShare {
  readonly label: string;
  readonly count: number;
}

/**
 * Completed payments in `asset`, grouped by the UTC day they completed.
 * At most the 14 most recent days that actually had a payment.
 */
function dailyOf(payments: readonly PaymentIntentDto[], asset: AssetCode): readonly DayPoint[] {
  const byDay = new Map<string, { volume: bigint; count: number }>();
  for (const p of payments) {
    if (p.status !== "COMPLETED" || p.amount.asset !== asset) continue;
    const day = (p.completedAt ?? p.createdAt).slice(0, 10);
    const bucket = byDay.get(day) ?? { volume: 0n, count: 0 };
    byDay.set(day, { volume: bucket.volume + BigInt(p.amount.amount), count: bucket.count + 1 });
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-14)
    .map(([date, bucket]) => ({ date, ...bucket }));
}

/** What payers actually sent, counted by rail asset. Rail-less intents show
 * as "Not selected" rather than being dropped — they are real payments. */
function mixOf(payments: readonly PaymentIntentDto[]): readonly AssetShare[] {
  const counts = new Map<string, number>();
  for (const p of payments) {
    const label = p.payment?.asset ?? "Not selected";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([label, count]) => ({ label, count }));
}

/* -------------------------------------------------------------------------- */
/* Daily volume                                                                */
/* -------------------------------------------------------------------------- */

function VolumeChart({
  points,
  asset,
  decimals,
  symbol,
}: {
  points: readonly DayPoint[];
  asset: AssetCode;
  decimals: number;
  symbol: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const max = points.reduce((acc, p) => (p.volume > acc ? p.volume : acc), 0n);
  // Four ticks including zero, computed in bigint so the labels are exact. The
  // quarter each tick sits at is carried along as its key: two ticks can share
  // a value when the series is flat, so the value alone is not unique.
  const ticks = [4n, 3n, 2n, 1n, 0n].map((n) => ({
    id: `q${n}`,
    value: (max * n) / 4n,
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        {/* Y axis. Recessive: no rule, no box, just the numbers. */}
        <ul className="flex w-16 shrink-0 flex-col justify-between py-0 text-right text-xs text-subtle-foreground">
          {ticks.map((t) => (
            <li key={t.id}>{compactMoney(t.value, decimals, symbol)}</li>
          ))}
        </ul>

        <div className="relative min-w-0 flex-1">
          {/* Gridlines sit under the marks and are never read aloud. */}
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between">
            {ticks.map((t) => (
              <span key={t.id} className="h-px w-full bg-border" />
            ))}
          </div>

          {/* Each column is a real button, so the series is reachable by tab
              and not only by pointer. The visual tooltip is decorative — the
              same three facts are on the button's own label, which is what a
              screen reader announces. */}
          <div className="relative flex h-40 items-end gap-0.5">
            {points.map((p, i) => {
              const height = percentOf(p.volume, max);
              const active = hovered === i;
              return (
                <button
                  type="button"
                  key={p.date}
                  // The hit target spans the full column height, not just the
                  // bar, so a short day is no harder to reach than a tall one.
                  className="relative flex h-full flex-1 cursor-pointer items-end bg-transparent p-0"
                  aria-label={`${dayLabel(p.date)}: ${formatMoneyLocale(money(p.volume, asset))} across ${p.count} payment${p.count === 1 ? "" : "s"}`}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                >
                  <motion.span
                    className={cn("w-full origin-bottom", active ? "bg-primary" : "bg-chart-1")}
                    style={{ height: `${height}%` }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{
                      duration: 0.4,
                      delay: i * 0.02,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                  {active && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 flex w-max max-w-48 -translate-x-1/2 flex-col border border-border bg-popover px-2 py-1.5 text-left text-xs shadow-sm"
                    >
                      <span className="font-medium text-foreground">{dayLabel(p.date)}</span>
                      <span className="text-muted-foreground">
                        {formatMoneyLocale(money(p.volume, asset))}
                      </span>
                      <span className="text-subtle-foreground">
                        {p.count} payment{p.count === 1 ? "" : "s"}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* X axis: only the ends and the middle are labelled. A label under every
          bar would collide long before fourteen days fit. */}
      <div className="flex gap-3">
        <span className="w-16 shrink-0" />
        <div className="flex min-w-0 flex-1 justify-between text-xs text-subtle-foreground">
          <span>{dayLabel(points[0]?.date ?? "")}</span>
          <span>{dayLabel(points[Math.floor(points.length / 2)]?.date ?? "")}</span>
          <span>{dayLabel(points[points.length - 1]?.date ?? "")}</span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Payer asset mix                                                             */
/* -------------------------------------------------------------------------- */

function AssetMixChart({ mix }: { mix: readonly AssetShare[] }) {
  const total = mix.reduce((acc, a) => acc + a.count, 0);
  const max = mix.reduce((acc, a) => (a.count > acc ? a.count : acc), 0);

  return (
    <ul className="flex flex-col gap-3">
      {mix.map((a, i) => {
        const share = total === 0 ? 0 : Math.round((a.count / total) * 100);
        return (
          <li key={a.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              {/* Direct label — identity never depends on the colour. */}
              <span className="font-medium text-foreground">{a.label}</span>
              <span className="text-subtle-foreground">
                {a.count} · {share}%
              </span>
            </div>
            <div className="h-2 w-full bg-muted">
              <motion.div
                className="h-full origin-left bg-chart-1"
                style={{ width: `${max === 0 ? 0 : (a.count / max) * 100}%` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{
                  duration: 0.45,
                  delay: i * 0.05,
                  ease: [0.16, 1, 0.3, 1],
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

/** A chart's numbers, reachable without reading the picture. */
function DataDisclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group">
      <summary className="w-fit cursor-pointer list-none text-xs text-muted-foreground underline decoration-input underline-offset-2 hover:text-foreground">
        {summary}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function Analytics() {
  const payments = usePayments(100);

  return match(payments)
    .with({ status: "pending" }, () => (
      <div role="status" aria-live="polite" className="flex flex-col gap-8">
        <span className="sr-only">Loading analytics</span>
        <StatGridSkeleton />
        <PanelSkeleton lines={5} />
        <PanelSkeleton lines={4} />
      </div>
    ))
    .with({ status: "error" }, ({ error }) => (
      <Alert variant="destructive">
        {error instanceof ApiError ? error.message : "Failed to load analytics"}
      </Alert>
    ))
    .with({ status: "success" }, ({ data }) => {
      const all = data.payments;
      const asset = dominantAsset(all.filter((p) => p.status === "COMPLETED").map((p) => p.amount));

      if (asset === undefined) {
        return (
          <div className="flex flex-col gap-8">
            <StatGrid>
              <Stat label="Payments" value={String(all.length)} hint="In the most recent 100." />
              <Stat label="Completed" value="0" hint="Nothing to chart yet." />
              <Stat label="Volume" value="—" hint="No completed payments." />
              <Stat label="Busiest day" value="—" hint="No completed payments." />
            </StatGrid>
            <Empty>
              <EmptyMedia>
                <ChartBarIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Charts appear after the first completed payment.</EmptyTitle>
            </Empty>
          </div>
        );
      }

      const decimals = assetDecimals(asset);
      const symbol = assetSymbol(asset) ?? asset;
      const daily = dailyOf(all, asset);
      const mix = mixOf(all);

      const totalVolume = daily.reduce((acc, p) => acc + p.volume, 0n);
      const totalCount = daily.reduce((acc, p) => acc + p.count, 0);
      const average = totalCount === 0 ? 0n : totalVolume / BigInt(totalCount);
      const busiest = daily.reduce(
        (acc, p) => (p.volume > acc.volume ? p : acc),
        daily[0] as DayPoint,
      );

      return (
        <div className="flex flex-col gap-8">
          <StatGrid>
            <Stat
              label="Volume"
              value={compactMoney(totalVolume, decimals, symbol)}
              hint={`Completed, in ${asset}. Most recent 100.`}
            />
            <Stat label="Payments" value={String(all.length)} hint="In the most recent 100." />
            <Stat
              label="Average payment"
              value={formatMoneyLocale(money(average, asset), { trimZeroFraction: true })}
              hint="Volume divided by completed count."
            />
            <Stat
              label="Busiest day"
              value={dayLabel(busiest.date)}
              hint={`${busiest.count} payment${busiest.count === 1 ? "" : "s"}.`}
            />
          </StatGrid>

          <section className="flex flex-col gap-3">
            <SectionHeader title="Daily volume" />
            <Card className="gap-4">
              <VolumeChart points={daily} asset={asset} decimals={decimals} symbol={symbol} />
              <DataDisclosure summary="Show the numbers">
                <Table>
                  <TableCaption>Daily completed volume, by day</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Volume</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {daily.map((p) => (
                      <TableRow key={p.date}>
                        <TableCell>{dayLabel(p.date)}</TableCell>
                        <TableCell className="text-right">
                          {formatMoneyLocale(money(p.volume, asset))}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {p.count}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataDisclosure>
            </Card>
          </section>

          <section className="flex flex-col gap-3">
            <SectionHeader title="What payers sent" />
            <Card className="gap-4">
              <AssetMixChart mix={mix} />
              <DataDisclosure summary="Show the numbers">
                <Table>
                  <TableCaption>Payments by payer asset</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Asset</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mix.map((a) => (
                      <TableRow key={a.label}>
                        <TableCell>{a.label}</TableCell>
                        <TableCell className="text-right">{a.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataDisclosure>
            </Card>
          </section>
        </div>
      );
    })
    .exhaustive();
}

export default withQuery(Analytics);
