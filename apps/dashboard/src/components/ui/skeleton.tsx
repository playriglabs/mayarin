import clsx from "clsx";
import type * as React from "react";
import { cn } from "@/lib/utils";

/** The base bar. Compose it; do not stack three of these and call it a page. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="skeleton" className={cn("h-8 animate-pulse bg-muted", className)} {...props} />
  );
}

/**
 * Composed skeletons, one per surface shape. Each island shows the skeleton
 * of ITS OWN layout — a stat strip loads as a stat strip, a table as rows —
 * so nothing jumps when the data lands. All of them are decoration: the
 * caller owns the `role="status"` live region and the `sr-only` sentence.
 */

/** Stable keys for a run of identical bars. */
function run(length: number): readonly number[] {
  return Array.from({ length }, (_, i) => i);
}

/** Mirrors `StatGrid`: the same hairline mosaic, cells of label/value/hint. */
function StatGridSkeleton({ cells = 4 }: { cells?: number }) {
  return (
    <div
      aria-hidden="true"
      className="grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4"
    >
      {run(cells).map((cell) => (
        <div key={cell} className="flex flex-col gap-2 bg-card p-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

/** Mirrors `Table`: a bordered surface with a header band and row bars. */
function TableSkeleton({ rows = 5, bigSize = false }: { rows?: number; bigSize?: boolean }) {
  return (
    <div aria-hidden="true" className="w-full border border-border bg-card">
      <div className={clsx("border-b border-border", bigSize ? "p-4" : "px-4 py-3")}>
        <Skeleton className={clsx("w-1/3", bigSize ? "h-4" : "h-3.5")} />
      </div>
      {run(rows).map((row) => (
        <div
          key={row}
          className={clsx("border-b border-border last:border-b-0", bigSize ? "p-4" : "px-4 py-3")}
        >
          <Skeleton className={clsx("w-full", bigSize ? "h-4.5" : "h-4")} />
        </div>
      ))}
    </div>
  );
}

/** Mirrors a `Card` of key/value rows or a chart: label bar plus lines. */
function PanelSkeleton({ lines = 6 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 border border-border bg-card p-4">
      <Skeleton className="h-3 w-24" />
      {run(lines).map((line) => (
        <Skeleton key={line} className="h-4 w-full" />
      ))}
    </div>
  );
}

/**
 * Mirrors the overview's balance card: label, figure, sentence, network marks,
 * and the chart under them.
 *
 * The chart's box is the same height as the real one. A skeleton shorter than
 * what replaces it is a page that jumps at the moment somebody starts reading
 * it, which is worse than no skeleton at all.
 */
function BalanceCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5 border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-3 w-48" />
        </div>
        <Skeleton className="h-6 w-14" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** Mirrors a movement card: title, total, hint, the link, and a sparkline. */
function MovementCardSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4 border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

/** Mirrors the settlement destination's address, asset, and readiness columns. */
function SettlementDestinationSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex flex-col gap-3 border border-border bg-card p-4 sm:flex-row sm:gap-8"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-4 w-full max-w-sm" />
      </div>
      <div className="flex w-24 flex-col gap-2">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex w-24 flex-col gap-2">
        <Skeleton className="h-3 w-14" />
        <Skeleton className="h-5 w-16" />
      </div>
    </div>
  );
}

/** Mirrors the QR plate and payment instructions rendered by `DepositQr`. */
function DepositQrSkeleton() {
  return (
    <div aria-hidden="true" className="flex w-full flex-col gap-4">
      <div className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)] md:items-center md:gap-6">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="size-48 md:size-52" />
          <Skeleton className="h-3 w-36" />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-56 max-w-full" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-6 w-24" />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-12 w-full" />
          </div>

          <div className="flex items-center gap-2 border-border border-t pt-3">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64 max-w-full" />
          </div>
        </div>
      </div>

      <div className="border-border border-t pt-3">
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
    </div>
  );
}

export {
  BalanceCardSkeleton,
  DepositQrSkeleton,
  MovementCardSkeleton,
  PanelSkeleton,
  SettlementDestinationSkeleton,
  Skeleton,
  StatGridSkeleton,
  TableSkeleton,
};
