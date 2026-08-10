import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Stat strip. Not a shadcn registry component — it is this product's own.
 *
 * One ruled surface holding every figure, not four boxes floating on the
 * page: `StatGrid` is a `gap-px` mosaic over the border colour, so the
 * hairlines between cells hold at every breakpoint without corner seams.
 * Each cell is a mono eyebrow, a 24px tabular figure and a hint — the
 * landing's spec-sheet voice. An optional status icon can reinforce values
 * that need attention without replacing the text label.
 */
function StatGrid({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-grid"
      className={cn(
        "grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
      {...props}
    />
  );
}

function Stat({
  label,
  value,
  hint,
  icon,
  className,
  ...props
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
} & React.ComponentProps<"div">) {
  return (
    <div data-slot="stat" className={cn("flex flex-col gap-2 bg-card p-4", className)} {...props}>
      <span className="label text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 text-2xl font-medium text-foreground tabular-nums">
        {icon}
        {value}
      </span>
      {hint !== undefined && <span className="text-xs text-subtle-foreground">{hint}</span>}
    </div>
  );
}

export { Stat, StatGrid };
