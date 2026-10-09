/**
 * One metric over time, as the analytics page draws it.
 *
 * A filled line by default: a single blue stroke, a fill that fades to almost
 * nothing at the baseline, dashed vertical rules on the date ticks and no Y
 * axis — the figure above the chart carries the magnitude, so a ruler beside it
 * would only repeat it less precisely. A bar variant is for discrete arrivals,
 * where a line between two days would draw a value that never existed.
 *
 * Hover is lifted out through `onHover` so a group of charts can share one
 * cursor; `activeIndex` draws that shared cursor on every chart in the group.
 */

import { useId } from "react";
import type { MouseHandlerDataParam } from "recharts";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
} from "recharts";
import type { MetricPoint } from "@/lib/analytics-series";

const MARGIN = { left: 24, right: 24, top: 24, bottom: 0 };

/** A zero-height bar is still drawn, a few pixels tall, so an empty day reads as a day. */
function MinHeightBar(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
}) {
  const { x = 0, y = 0, width = 0, height = 0, fill } = props;
  const minimum = 4;
  return (
    <rect
      x={x}
      y={height === 0 ? y - minimum : y}
      width={width}
      height={height === 0 ? minimum : height}
      fill={fill}
      opacity={height === 0 ? 0.35 : 1}
    />
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  formatDate,
  name,
}: {
  active?: boolean;
  payload?: readonly { payload: MetricPoint }[];
  label?: string;
  formatDate: (date: string) => string;
  name: string;
}) {
  const point = payload?.[0]?.payload;
  if (active !== true || point === undefined) return null;

  return (
    <div className="flex min-w-44 flex-col gap-1.5 rounded-lg border border-border bg-popover px-3 py-2 text-sm shadow-sm">
      <span className="text-muted-foreground">{formatDate(label ?? point.date)}</span>
      <span className="flex items-center justify-between gap-6">
        <span className="flex items-center gap-2 text-foreground">
          <span aria-hidden="true" className="size-2 rounded-full bg-chart-1" />
          {name}
        </span>
        <span className="text-foreground tabular-nums">{point.display}</span>
      </span>
    </div>
  );
}

export function MetricChart({
  points,
  name,
  chart = "line",
  height = 200,
  formatDate,
  activeIndex,
  onHover,
}: {
  readonly points: readonly MetricPoint[];
  /** The series name the tooltip shows beside the value. */
  readonly name: string;
  readonly chart?: "line" | "bar";
  readonly height?: number;
  readonly formatDate: (date: string) => string;
  readonly activeIndex?: number | null;
  readonly onHover?: (index: number | null) => void;
}) {
  const gradientId = useId();
  const data = [...points];
  const cursorDate = activeIndex == null ? undefined : points[activeIndex]?.date;

  const common = {
    data,
    margin: MARGIN,
    onMouseMove: (state: MouseHandlerDataParam) => {
      const index = state.activeTooltipIndex;
      const parsed = typeof index === "number" ? index : Number.parseInt(String(index), 10);
      onHover?.(Number.isNaN(parsed) ? null : parsed);
    },
    onMouseLeave: () => onHover?.(null),
  };

  const grid = (
    <CartesianGrid
      horizontal={false}
      vertical
      stroke="var(--color-border)"
      strokeDasharray="6 6"
      syncWithTicks
    />
  );
  const xAxis = (
    <XAxis
      dataKey="date"
      tickLine={false}
      axisLine={false}
      tickMargin={8}
      interval="equidistantPreserveStart"
      tickFormatter={formatDate}
      tick={{ fontSize: 12, fill: "var(--color-subtle-foreground)" }}
    />
  );
  const tooltip = (
    <RechartsTooltip
      cursor={false}
      content={<ChartTooltip formatDate={formatDate} name={name} />}
    />
  );
  const cursor =
    cursorDate === undefined ? null : (
      <ReferenceLine x={cursorDate} stroke="var(--color-input)" strokeWidth={1} />
    );

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {chart === "bar" ? (
          <BarChart {...common}>
            {grid}
            {xAxis}
            {tooltip}
            {cursor}
            <Bar
              dataKey="value"
              fill="var(--color-chart-1)"
              maxBarSize={8}
              radius={0}
              shape={<MinHeightBar />}
              isAnimationActive={false}
            />
          </BarChart>
        ) : (
          <AreaChart {...common}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.025} />
              </linearGradient>
            </defs>
            {grid}
            {xAxis}
            {tooltip}
            {cursor}
            <Area
              dataKey="value"
              type="linear"
              stroke="var(--color-chart-1)"
              strokeWidth={1.5}
              fill={`url(#${gradientId})`}
              dot={false}
              activeDot={{ r: 3, className: "fill-chart-1 stroke-background" }}
              isAnimationActive={false}
            />
          </AreaChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
