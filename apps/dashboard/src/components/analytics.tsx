/**
 * Merchant analytics — a React island over the dedicated `/analytics` read.
 *
 * The read is unpaginated, every payment and settlement, so every filter here
 * is a slice of data already in hand: changing the range, the interval, the
 * network or the payer asset never waits on the network.
 *
 * Four dashboards, because a merchant asks four different questions:
 *
 * - **Revenue** — how much came in, before and after fees.
 * - **Orders** — how many checkouts became payments, and how fast.
 * - **Settlements** — what reached the merchant, and in what state.
 * - **Payment mix** — what payers sent, from where, on which network.
 *
 * Pay ins are dated by creation (an order belongs to the day it was placed),
 * pay outs by arrival. Charting one and calling it both would hide the fee and
 * every payment that was taken and never settled.
 */

import { chainLabel } from "@mayarin/chain";
import { ChartBarIcon, InfoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { AssetLogo } from "@/components/asset-logo";
import { ChainLogo } from "@/components/chain-logo";
import { PageHeader } from "@/components/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { MetricChart } from "@/components/ui/metric-chart";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAnalytics } from "@/hooks/analytics";
import {
  payerAssetBreakdown,
  payerCountryBreakdown,
  payerNetworkBreakdown,
  type RankedInsight,
} from "@/lib/analytics-insights";
import {
  type Filters,
  filterPayments,
  filterSettlements,
  type Interval,
  isSettled,
  lastDays,
  type Metric,
  metricsOf,
  ORDERS,
  paymentsInRange,
  type Range,
  REVENUE,
  SETTLEMENTS,
  settlementsInRange,
} from "@/lib/analytics-series";
import { ApiError } from "@/lib/api/client";
import { countryLabel } from "@/lib/countries";
import { ICON_CARD } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type { AnalyticsResponse } from "@/types/analytics";
import type { PaymentIntentDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

/* -------------------------------------------------------------------------- */
/* Filters                                                                     */
/* -------------------------------------------------------------------------- */

const DASHBOARDS = [
  { value: "revenue", label: "Revenue" },
  { value: "orders", label: "Orders" },
  { value: "settlements", label: "Settlements" },
  { value: "mix", label: "Payment mix" },
] as const;

type Dashboard = (typeof DASHBOARDS)[number]["value"];

const INTERVALS: readonly SelectOption[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

const RANGES: readonly SelectOption[] = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
];

/** A range long enough that a day per point is noise picks a coarser default. */
function intervalFor(days: number): Interval {
  if (days >= 365) return "month";
  if (days >= 90) return "week";
  return "day";
}

const ALL = "all";

function dashboardFromHash(): Dashboard {
  if (typeof window === "undefined") return "revenue";
  const hash = window.location.hash.slice(1);
  return DASHBOARDS.find((dashboard) => dashboard.value === hash)?.value ?? "revenue";
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: "UTC" });
const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const LONG = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function dateOf(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

function bucketLabel(interval: Interval): (key: string) => string {
  return (key) => (interval === "month" ? MONTH : DAY).format(dateOf(key));
}

function rangeLabel(range: Range): string {
  return `${LONG.format(dateOf(range.from))} – ${LONG.format(dateOf(range.to))}`;
}

function FilterSelect({
  label,
  items,
  value,
  onChange,
  className,
}: {
  readonly label: string;
  readonly items: readonly SelectOption[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly className?: string | undefined;
}) {
  return (
    <Select items={items} value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className={cn("h-9.5 w-auto min-w-32", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Every value the read actually holds, so a filter never offers an empty slice. */
function optionsOf(
  values: readonly (string | undefined)[],
  all: string,
  labelOf: (value: string) => string,
): readonly SelectOption[] {
  const present = [...new Set(values.filter((value): value is string => value !== undefined))];
  return [
    { value: ALL, label: all },
    ...present.sort().map((value) => ({ value, label: labelOf(value) })),
  ];
}

/* -------------------------------------------------------------------------- */
/* Metric boxes                                                                */
/* -------------------------------------------------------------------------- */

function Hint({ text }: { readonly text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={text}
              className="cursor-help text-subtle-foreground transition-colors hover:text-foreground"
            >
              <InfoIcon size={15} aria-hidden="true" />
            </button>
          }
        />
        <TooltipContent className="max-w-64">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Change({ value }: { readonly value: number | undefined }) {
  if (value === undefined || !Number.isFinite(value) || Math.round(value) === 0) return null;
  const up = value > 0;
  return (
    <span
      title="Against the period before"
      className={cn(
        "rounded-md px-2 py-0.5 text-sm tabular-nums",
        up ? "bg-success-muted text-success" : "bg-destructive-muted text-destructive",
      )}
    >
      {up ? "+" : ""}
      {Math.round(value)}%
    </span>
  );
}

/** A box's frame: title row, the big figure, then what it covers. */
function Box({
  title,
  hint,
  aside,
  children,
  className,
}: {
  readonly title: string;
  readonly hint: string;
  readonly aside?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string | undefined;
}) {
  return (
    <section
      className={cn("flex min-w-0 flex-col gap-2 border-border border-r border-b py-6", className)}
    >
      <header className="flex items-center justify-between gap-4 px-6">
        <h3 className="flex items-center gap-2 text-[18px] leading-6 text-foreground">
          {title}
          <Hint text={hint} />
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function MetricBox({
  metric,
  range,
  interval,
  hovered,
  onHover,
  className,
}: {
  readonly metric: Metric;
  readonly range: Range;
  readonly interval: Interval;
  readonly hovered: number | null;
  readonly onHover: (index: number | null) => void;
  readonly className?: string | undefined;
}) {
  const point = hovered === null ? undefined : metric.points[hovered];
  const label = bucketLabel(interval);

  return (
    <Box
      title={metric.label}
      hint={metric.hint}
      aside={<Change value={metric.change} />}
      className={className}
    >
      <div className="flex flex-col gap-3 px-6">
        <span className="text-[34px] leading-10 font-normal tracking-[-0.02em] text-foreground tabular-nums xl:text-[44px] xl:leading-13">
          {point?.display ?? metric.total}
        </span>
        <span className="flex items-center gap-2 text-sm text-muted-foreground tabular-nums">
          <span aria-hidden="true" className="size-3 rounded-full border-2 border-chart-1" />
          {point === undefined ? rangeLabel(range) : LONG.format(dateOf(point.date))}
        </span>
      </div>
      <MetricChart
        points={metric.points}
        name={metric.label}
        chart={metric.chart}
        formatDate={label}
        activeIndex={hovered}
        onHover={onHover}
      />
    </Box>
  );
}

/**
 * Boxes sharing one ruled surface and one cursor: hovering a day on any chart
 * moves every chart in the group to that day, so a spike in revenue can be read
 * against the orders that made it.
 */
function MetricGrid({
  metrics,
  range,
  interval,
  children,
}: {
  readonly metrics: readonly Metric[];
  readonly range: Range;
  readonly interval: Interval;
  readonly children?: React.ReactNode;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      {/* The inset clip hides each box's outer border, so only the rules
          between boxes show at every breakpoint. */}
      <div className="grid grid-cols-1 [clip-path:inset(0_1px_1px_0)] lg:grid-cols-2 2xl:grid-cols-3">
        {metrics.map((metric, index) => (
          <MetricBox
            key={metric.key}
            metric={metric}
            range={range}
            interval={interval}
            hovered={hovered}
            onHover={setHovered}
            className={index === 0 ? "lg:col-span-2" : undefined}
          />
        ))}
        {children}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Breakdowns                                                                  */
/* -------------------------------------------------------------------------- */

const MIX_FILLS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
] as const;

function mixFill(index: number): string {
  return MIX_FILLS[index % MIX_FILLS.length] ?? "bg-chart-1";
}

/**
 * Part-to-whole: one stacked bar, then a legend that repeats every segment by
 * name, count and share — so colour is never the only thing telling them apart.
 */
function Breakdown({
  rows,
  labelOf = (value) => value,
  markOf,
}: {
  readonly rows: readonly RankedInsight[];
  readonly labelOf?: (value: string) => string;
  readonly markOf?: (value: string) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return <p className="px-6 py-14 text-center text-base text-subtle-foreground">Nothing yet.</p>;
  }

  return (
    <div className="flex flex-col gap-5 px-6 pt-4">
      <div aria-hidden="true" className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {rows.map((row, index) => (
          <span
            key={row.key}
            className={cn("h-full shrink-0", mixFill(index))}
            style={{ width: `${row.share * 100}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <li key={row.key} className="flex items-center justify-between gap-3 text-base">
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn("size-2.5 shrink-0 rounded-sm", mixFill(index))}
              />
              {markOf?.(row.key)}
              <span className="truncate text-foreground">{labelOf(row.key)}</span>
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {row.count} · {Math.round(row.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SETTLEMENT_STATES: Readonly<Record<string, string>> = {
  SUCCESS: "Complete",
  SETTLED: "Settled",
  SETTLING: "Settling",
  CLEARING: "Clearing",
  FAILED: "Failed",
};

/** Settlements in the range by current state; a state not named here keeps its raw name. */
function stateBreakdown(settlements: readonly SettlementDto[]): readonly RankedInsight[] {
  const counts = new Map<string, number>();
  for (const settlement of settlements) {
    counts.set(settlement.state, (counts.get(settlement.state) ?? 0) + 1);
  }
  const total = settlements.length;
  return [...counts]
    .map(([key, count]) => ({ key, count, share: total === 0 ? 0 : count / total }))
    .sort((a, b) => b.count - a.count);
}

function StatusBox({ settlements }: { readonly settlements: readonly SettlementDto[] }) {
  const settled = settlements.filter(isSettled).length;
  const rate =
    settlements.length === 0 ? undefined : Math.round((settled / settlements.length) * 100);

  return (
    <Box title="Status overview" hint="Settlements in the range, by their current state.">
      <div className="flex flex-col gap-3 px-6">
        <span className="text-[34px] leading-10 font-normal tracking-[-0.02em] text-foreground tabular-nums xl:text-[44px] xl:leading-13">
          {rate === undefined ? "—" : `${rate}%`}
        </span>
        <span className="text-sm text-muted-foreground">
          {settled} of {settlements.length} settled
        </span>
      </div>
      <Breakdown
        rows={stateBreakdown(settlements)}
        labelOf={(state) => SETTLEMENT_STATES[state] ?? state}
      />
    </Box>
  );
}

function MixGrid({ payments }: { readonly payments: readonly PaymentIntentDto[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="grid grid-cols-1 [clip-path:inset(0_1px_1px_0)] lg:grid-cols-3">
        <Box title="Payer assets" hint="What payers sent for completed payments.">
          <Breakdown
            rows={payerAssetBreakdown(payments)}
            markOf={(asset) =>
              asset === "Others" || asset === "Unknown" ? null : (
                <AssetLogo symbol={asset} size={18} />
              )
            }
          />
        </Box>
        <Box title="Networks" hint="The network each completed payment was paid on.">
          <Breakdown
            rows={payerNetworkBreakdown(payments)}
            labelOf={(chain) =>
              chain === "Others" || chain === "Unknown" ? chain : chainLabel(chain)
            }
            markOf={(chain) =>
              chain === "Others" || chain === "Unknown" ? null : (
                <ChainLogo chain={chain} size={18} />
              )
            }
          />
        </Box>
        <Box
          title="Payer countries"
          hint="Country captured at checkout. Older payments without it show as Unknown."
        >
          <Breakdown
            rows={payerCountryBreakdown(payments)}
            labelOf={(country) =>
              country === "Unknown" || country === "Others" ? country : countryLabel(country)
            }
          />
        </Box>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

function Dashboards({ data }: { readonly data: AnalyticsResponse }) {
  const [dashboard, setDashboard] = useState<Dashboard>(dashboardFromHash);
  const [days, setDays] = useState(30);
  const [interval, setBucketInterval] = useState<Interval>("day");
  const [chain, setChain] = useState(ALL);
  const [asset, setAsset] = useState(ALL);

  const range = lastDays(new Date(), days);
  const filters: Filters = {
    chain: chain === ALL ? undefined : chain,
    asset: asset === ALL ? undefined : asset,
  };
  const payments = filterPayments(data.payments, filters);
  const settlements = filterSettlements(data.settlements, filters);
  const input = { payments, settlements, range, interval, rates: data.usdRates };

  const networks = optionsOf(
    data.payments.map((payment) => payment.payment?.chain),
    "All networks",
    chainLabel,
  );
  const assets = optionsOf(
    data.payments.map((payment) => payment.payment?.asset),
    "All assets",
    (value) => value,
  );

  function choose(next: Dashboard) {
    setDashboard(next);
    window.history.replaceState(null, "", `#${next}`);
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        className="mb-6"
        actions={
          <fieldset aria-label="Analytics filters" className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Interval"
              items={INTERVALS}
              value={interval}
              onChange={(value) => setBucketInterval(value as Interval)}
            />
            <FilterSelect
              label="Date range"
              items={RANGES}
              value={String(days)}
              onChange={(value) => {
                const next = Number(value);
                setDays(next);
                setBucketInterval(intervalFor(next));
              }}
            />
            <FilterSelect label="Network" items={networks} value={chain} onChange={setChain} />
            <FilterSelect label="Payer asset" items={assets} value={asset} onChange={setAsset} />
          </fieldset>
        }
      />

      <nav
        aria-label="Dashboards"
        className="mb-6 flex gap-1 overflow-x-auto border-border border-b"
      >
        {DASHBOARDS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            aria-current={dashboard === entry.value ? "page" : undefined}
            onClick={() => choose(entry.value)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 pb-3 text-base transition-colors",
              dashboard === entry.value
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {match(dashboard)
        .with("revenue", () => (
          <MetricGrid
            metrics={metricsOf(REVENUE, { ...input, cumulative: true })}
            range={range}
            interval={interval}
          />
        ))
        .with("orders", () => (
          <MetricGrid metrics={metricsOf(ORDERS, input)} range={range} interval={interval} />
        ))
        .with("settlements", () => (
          <MetricGrid metrics={metricsOf(SETTLEMENTS, input)} range={range} interval={interval}>
            <StatusBox settlements={settlementsInRange(settlements, range)} />
          </MetricGrid>
        ))
        .with("mix", () => <MixGrid payments={paymentsInRange(payments, range)} />)
        .exhaustive()}
    </>
  );
}

function Analytics() {
  const analytics = useAnalytics();

  return match(analytics)
    .with({ status: "pending" }, () => (
      <>
        <PageHeader title="Analytics" />
        <PageLoader label="Loading analytics" className="min-h-128" />
      </>
    ))
    .with({ status: "error" }, ({ error }) => (
      <>
        <PageHeader title="Analytics" />
        <QueryError
          message={error instanceof ApiError ? error.message : "Failed to load analytics"}
          retry={() => void analytics.refetch()}
          retrying={analytics.isFetching}
        />
      </>
    ))
    .with({ status: "success" }, ({ data }) =>
      data.payments.length === 0 ? (
        <>
          <PageHeader title="Analytics" />
          <Empty>
            <EmptyMedia>
              <ChartBarIcon size={ICON_CARD} aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Charts appear after the first payment.</EmptyTitle>
            <EmptyDescription>
              Take a payment to begin tracking revenue and settlement.
            </EmptyDescription>
            <EmptyAction>
              <a href="/links" className={buttonVariants()}>
                Take your first payment
              </a>
            </EmptyAction>
          </Empty>
        </>
      ) : (
        <Dashboards data={data} />
      ),
    )
    .exhaustive();
}

export default withQuery(Analytics);
