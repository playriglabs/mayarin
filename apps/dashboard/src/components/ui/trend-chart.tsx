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
 * single chart blue rather than a per-series palette. The axes stay recessive:
 * no axis lines, two Y labels, and evenly sampled date ticks over faint dashed
 * rules so a month reads like a reporting window instead of a sparkline.
 */

import { useId } from "react";
// Recharts ships its own `Tooltip`, which is a chart overlay rather than the
// hover popup this app means by the word. Aliased so both can be used here.
import {
  Area,
  AreaChart,
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

/** Evenly spaced date keys keep a month readable without colliding labels. */
function dateTicks(points: readonly Plot[], count = 7): readonly string[] {
  if (points.length <= count) return points.map((point) => point.date);
  return Array.from({ length: count }, (_, index) => {
    const pointIndex = Math.round((index * (points.length - 1)) / (count - 1));
    return points[pointIndex]?.date ?? "";
  });
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
 * The single blue series, faint dashed date grid and sampled labels mirror the
 * overview's reporting language without letting chart chrome outrank the data.
 */
export function TrendChart({
  points,
  formatTick,
  className = "h-44",
  showAxes = true,
  showYAxis = true,
  ariaLabel,
}: {
  points: readonly Plot[];
  formatTick: (value: number) => string;
  /** Height, so a sparkline and a full chart can share one implementation. */
  className?: string;
  /** Off for a sparkline, where the axes would be most of the picture. */
  showAxes?: boolean;
  /** A compact metric can keep date context without reserving a value gutter. */
  showYAxis?: boolean;
  /** Concise chart summary for readers who cannot perceive the plotted line. */
  ariaLabel?: string;
}) {
  const gradientId = useId();
  const axis = axisOf(points, 2);

  if (points.length === 0) {
    return <p className="py-14 text-center text-subtle-foreground text-xs">Nothing yet.</p>;
  }

  return (
    <div
      className={cn("w-full", className)}
      role="img"
      aria-label={ariaLabel ?? "Time series chart"}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...points]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {showAxes && (
            <CartesianGrid horizontal={false} stroke="var(--color-border)" strokeDasharray="5 7" />
          )}
          {showAxes && (
            <XAxis
              dataKey="date"
              tickFormatter={dayLabel}
              ticks={[...dateTicks(points)]}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: "var(--color-subtle-foreground)" }}
              interval="preserveStartEnd"
            />
          )}
          {showAxes && showYAxis && (
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
            strokeWidth={2}
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
