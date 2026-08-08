/**
 * Merchant analytics — a React island over fixture data.
 *
 * Two charts, both single-series, both drawn in one hue.
 *
 * The colour choice is deliberate and worth stating, because the obvious
 * alternative is wrong: shading bars light-to-dark by value would be colour
 * following RANK rather than an entity, which makes the hue redundant with the
 * length already encoding magnitude, and repaints every bar the moment the sort
 * changes. Length carries magnitude; the direct label carries identity; the hue
 * is constant and means only "this is data".
 *
 * Marks are square-ended rather than the usual soft data-end. The design
 * system has no corner radius, and consistency with the rest of the product
 * wins over a chart convention.
 *
 * Each chart ships a real table behind a disclosure, so the numbers are
 * reachable without reading a picture.
 */

import { assetDecimals, assetSymbol } from "@mayarin/shared/asset";
import { formatMoneyLocale } from "@mayarin/shared/locale";
import { money } from "@mayarin/shared/money";
import { motion } from "motion/react";
import { useState } from "react";
import { Card } from "@/components/ui/card";
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
import { compactMoney, percentOf } from "@/lib/compact";
import { DAILY, type DayPoint, PAYER_ASSETS } from "@/lib/fixtures";
import { MotionProvider } from "@/lib/motion";
import { cn } from "@/lib/utils";

const IDR_DECIMALS = assetDecimals("IDR");
const IDR_SYMBOL = assetSymbol("IDR") ?? "Rp";

const DAY_LABEL = new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short" });

function dayLabel(iso: string): string {
  return DAY_LABEL.format(new Date(`${iso}T00:00:00Z`));
}

/* -------------------------------------------------------------------------- */
/* Daily volume                                                                */
/* -------------------------------------------------------------------------- */

function VolumeChart({ points }: { points: readonly DayPoint[] }) {
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
            <li key={t.id}>{compactMoney(t.value, IDR_DECIMALS, IDR_SYMBOL)}</li>
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
                  aria-label={`${dayLabel(p.date)}: ${formatMoneyLocale(money(p.volume, "IDR"))} across ${p.count} payment${p.count === 1 ? "" : "s"}`}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                >
                  <motion.span
                    className={cn("w-full origin-bottom", active ? "bg-primary" : "bg-brand")}
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
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 flex w-max max-w-48 -translate-x-1/2 flex-col border border-border bg-card px-2 py-1.5 text-left text-xs shadow-sm"
                    >
                      <span className="font-medium text-foreground">{dayLabel(p.date)}</span>
                      <span className="text-muted-foreground">
                        {formatMoneyLocale(money(p.volume, "IDR"))}
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

function AssetMixChart() {
  const total = PAYER_ASSETS.reduce((acc, a) => acc + a.count, 0);
  const max = PAYER_ASSETS.reduce((acc, a) => (a.count > acc ? a.count : acc), 0);

  return (
    <ul className="flex flex-col gap-3">
      {PAYER_ASSETS.map((a, i) => {
        const share = total === 0 ? 0 : Math.round((a.count / total) * 100);
        return (
          <li key={a.asset} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-xs">
              {/* Direct label — identity never depends on the colour. */}
              <span className="font-medium text-foreground">{a.asset}</span>
              <span className="text-subtle-foreground">
                {a.count} · {share}%
              </span>
            </div>
            <div className="h-2 w-full bg-muted">
              <motion.div
                className="h-full origin-left bg-brand"
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

export default function Analytics() {
  const totalVolume = DAILY.reduce((acc, p) => acc + p.volume, 0n);
  const totalCount = DAILY.reduce((acc, p) => acc + p.count, 0);
  const average = totalCount === 0 ? 0n : totalVolume / BigInt(totalCount);
  const busiest = DAILY.reduce((acc, p) => (p.volume > acc.volume ? p : acc), DAILY[0] as DayPoint);

  return (
    <MotionProvider>
      <div className="flex flex-col gap-8">
        <StatGrid>
          <Stat
            label="Volume"
            value={compactMoney(totalVolume, IDR_DECIMALS, IDR_SYMBOL)}
            hint="Last 14 days."
          />
          <Stat label="Payments" value={String(totalCount)} hint="Last 14 days." />
          <Stat
            label="Average payment"
            value={formatMoneyLocale(money(average, "IDR"), { trimZeroFraction: true })}
            hint="Volume divided by count."
          />
          <Stat
            label="Busiest day"
            value={dayLabel(busiest.date)}
            hint={`${busiest.count} payments.`}
          />
        </StatGrid>

        <section className="flex flex-col gap-3">
          <SectionHeader title="Daily volume" />
          <Card className="gap-4">
            <VolumeChart points={DAILY} />
            <DataDisclosure summary="Show the numbers">
              <Table>
                <TableCaption>Daily payment volume for the last 14 days</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {DAILY.map((p) => (
                    <TableRow key={p.date}>
                      <TableCell>{dayLabel(p.date)}</TableCell>
                      <TableCell className="text-right">
                        {formatMoneyLocale(money(p.volume, "IDR"))}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{p.count}</TableCell>
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
            <AssetMixChart />
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
                  {PAYER_ASSETS.map((a) => (
                    <TableRow key={a.asset}>
                      <TableCell>{a.asset}</TableCell>
                      <TableCell className="text-right">{a.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </DataDisclosure>
          </Card>
        </section>
      </div>
    </MotionProvider>
  );
}
