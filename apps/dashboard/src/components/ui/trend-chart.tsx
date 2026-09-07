/**
 * A filled line over time, on Recharts.
 *
 * Shared, because the overview and the analytics page ask the same question of
 * different figures and a second implementation would drift from this one.
 *
 * Hand-drawn SVG got the shape but not the behaviour: a shared cursor, a
 * tooltip that tracks the nearest point rather than the column under the mouse,
 * and axis ticks that thin out as the series grows are all things this library
 * already does correctly.
 *
 * Two departures from its defaults, both deliberate. The hue is the product's
 * single chart colour rather than a per-series palette — length carries
 * magnitude here and colour means only "this is data". And the axes are
 * recessive: no grid, no axis lines, two Y labels and two X labels, because a
 * label under every one of fourteen days collides long before it informs.
 */

import { useId } from "react";
// Recharts ships its own `Tooltip`, which is a chart overlay rather than the
// hover popup this app means by the word. Aliased so both can be used here.
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";

const DAY_LABEL = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "short" });

/** A UTC day key (`2026-09-07`) as a reader sees it. */
export function dayLabel(iso: string): string {
  return DAY_LABEL.format(new Date(`${iso}T00:00:00Z`));
}

export interface Plot {
  readonly date: string;
  /** Plotted height. A float, because this is geometry rather than accounting. */
  readonly value: number;
  /** Preformatted: only the caller knows whether this is money or a duration. */
  readonly label: string;
  readonly detail: string;
}

/**
 * The axis, computed here rather than by the library.
 *
 * Recharts derives "nice" ticks from the domain, and on these series it can
 * derive a step small enough relative to the range to generate hundreds of
 * thousands of them — which it then spreads into one call and overflows the
 * stack on: `RangeError: Maximum call stack size exceeded at Array.unshift`.
 * Minor units make that easy to hit, because a balance of sixty-eight dollars
 * is sixty-eight million of them.
 *
 * Fixed ticks over a fixed domain removes the algorithm from the path
 * altogether. A flat or empty series gets a domain of `[0, 1]` so the axis
 * still has a range to draw; without it the domain is `[0, 0]` and the same
 * generator divides by zero.
 */
function axisOf(points: readonly Plot[], count: number) {
  const max = points.reduce((acc, point) => Math.max(acc, point.value), 0);
  const top = max > 0 ? max : 1;
  return {
    domain: [0, top] as [number, number],
    ticks: Array.from({ length: count }, (_, i) => (top * i) / (count - 1)),
  };
}

/**
 * A domain given here is a request, not a rule.
 *
 * Recharts widens a domain to fit data outside it unless told otherwise, and a
 * widened domain leaves fixed ticks bunched wherever they happen to fall — a
 * `$ 0,00` label a quarter of the way down the chart, with the series running
 * below it. `allowDataOverflow` makes the domain the actual scale and clips
 * anything outside, which is what a fixed axis has to mean.
 */
const CLIP_TO_DOMAIN = true;

/** The tooltip pill: a dot, the day, the figure, and what it is made of. */
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload: Plot }[];
}) {
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined) return null;

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 shrink-0 bg-chart-1" />
        <span className="font-medium text-foreground">{dayLabel(point.date)}</span>
      </span>
      <span className="text-muted-foreground">{point.label}</span>
      <span className="text-subtle-foreground">{point.detail}</span>
    </div>
  );
}

/**
 * A filled line over time, on Recharts.
 *
 * Hand-drawn SVG got the shape but not the behaviour: a shared cursor, a
 * tooltip that tracks the nearest point rather than the column under the mouse,
 * and axis ticks that thin out as the series grows are all things this library
 * already does correctly.
 *
 * Two departures from its defaults, both deliberate. The hue is the product's
 * single chart colour rather than a per-series palette — length carries
 * magnitude here and colour means only "this is data". And the axes are
 * recessive: no grid, no axis lines, two Y labels and two X labels, because a
 * label under every one of fourteen days collides long before it informs.
 */
export function TrendChart({
  points,
  formatTick,
  className = "h-44",
  showAxes = true,
}: {
  points: readonly Plot[];
  formatTick: (value: number) => string;
  /** Height, so a sparkline and a full chart can share one implementation. */
  className?: string;
  /** Off for a sparkline, where the axes would be most of the picture. */
  showAxes?: boolean;
}) {
  const gradientId = useId();
  const axis = axisOf(points, 2);

  if (points.length === 0) {
    return <p className="py-14 text-center text-subtle-foreground text-xs">Nothing yet.</p>;
  }

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.25} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {showAxes && (
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              // First and last only: the reference labels the ends of the window
              // and nothing between them, which is what fits.
              ticks={[points[0]?.date ?? "", points[points.length - 1]?.date ?? ""]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--color-subtle-foreground)" }}
              interval="preserveStartEnd"
            />
          )}
          {showAxes && (
            <YAxis
              width={64}
              tickFormatter={formatTick}
              domain={axis.domain}
              ticks={axis.ticks}
              allowDataOverflow={CLIP_TO_DOMAIN}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--color-subtle-foreground)" }}
            />
          )}
          <RechartsTooltip
            content={<ChartTooltip />}
            cursor={{ stroke: "var(--color-input)", strokeDasharray: "3 3" }}
          />
          <Area
            type="linear"
            dataKey="value"
            stroke="var(--color-chart-1)"
            strokeWidth={1.5}
            fill={`url(#${gradientId})`}
            // The dot appears on hover only. Fourteen of them at rest is a
            // series competing with itself for attention.
            dot={false}
            activeDot={{ r: 3, className: "fill-chart-1 stroke-background" }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * The same series as columns.
 *
 * A day's takings are a discrete quantity, and a line between two of them draws
 * a value that never existed — worse on a series that is mostly zero, where the
 * line becomes a flat baseline implying a steady trickle rather than nothing at
 * all. Bars say "this day, this much", and a day with no payments is visibly
 * empty.
 *
 * A balance is the opposite case and stays a line: it genuinely holds a value
 * between two readings.
 */
export function TrendBars({
  points,
  formatTick,
  className = "h-44",
  showAxes = true,
}: {
  points: readonly Plot[];
  formatTick: (value: number) => string;
  className?: string;
  showAxes?: boolean;
}) {
  const axis = axisOf(points, 5);

  if (points.length === 0) {
    return <p className="py-14 text-center text-subtle-foreground text-xs">Nothing yet.</p>;
  }

  return (
    <div className={cn("w-full", className)}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={[...points]}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          // A gap a third of the column's width: enough that each day is its
          // own object rather than a filled region, without the series turning
          // into a row of tally marks.
          barCategoryGap="25%"
        >
          {showAxes && (
            <CartesianGrid
              // Horizontal only. A vertical line between two days would draw a
              // boundary the data does not have.
              vertical={false}
              stroke="var(--color-border)"
            />
          )}
          {showAxes && (
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              ticks={[points[0]?.date ?? "", points[points.length - 1]?.date ?? ""]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--color-subtle-foreground)" }}
              interval="preserveStartEnd"
            />
          )}
          {showAxes && (
            <YAxis
              width={64}
              tickFormatter={formatTick}
              // More than the line chart's two: a column is read against the
              // gridline behind it, so the ticks are doing work here that the
              // shape of a line does on its own.
              domain={axis.domain}
              ticks={axis.ticks}
              allowDataOverflow={CLIP_TO_DOMAIN}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--color-subtle-foreground)" }}
            />
          )}
          <RechartsTooltip
            content={<ChartTooltip />}
            // A filled band rather than a line: the hit area is the column, and
            // a cursor thinner than the bar it highlights points between them.
            cursor={{ fill: "var(--color-muted)" }}
          />
          <Bar
            dataKey="value"
            className="fill-chart-1"
            // Square, like everything else here — the radius scale is pinned to
            // zero and a rounded bar would be the one exception on the page.
            radius={0}
            maxBarSize={18}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
