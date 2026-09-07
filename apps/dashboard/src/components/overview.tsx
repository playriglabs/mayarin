/**
 * Overview — a React island summarising the merchant's real payment data.
 *
 * Headline figures use the complete, unpaginated analytics read. Volume is
 * settlement volume rather than the customer's payment currency, so it is
 * reported in the asset the merchant receives (USDC for a USDC merchant).
 */

import { assetDecimals, isAssetCode } from "@mayarin/shared/asset";
import { formatMoneyLocale } from "@mayarin/shared/locale";
import { money } from "@mayarin/shared/money";
import {
  CheckCircleIcon,
  CoinsIcon,
  HourglassMediumIcon,
  ReceiptIcon,
} from "@phosphor-icons/react";
import { match } from "ts-pattern";
import { ChainStack } from "@/components/chain-logo";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { QueryError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import { StatGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
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
import { type Plot, TrendChart } from "@/components/ui/trend-chart";
import { useAnalytics } from "@/hooks/analytics";
import { useSettings, useWalletBalance, useWalletWithdrawalHistory } from "@/hooks/settings";
import { ApiError } from "@/lib/api/client";
import { intentStatusLabel, toneOf } from "@/lib/clearing";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { display, dominantAsset, totalIn } from "@/lib/money";
import { withQuery } from "@/lib/with-query";
import type { ChainBalanceDto, WalletWithdrawalDto } from "@/types/settings";
import type { SettlementDto } from "@/types/settlement";

const IN_PROGRESS = new Set(["CREATED", "CONFIRMED", "PROCESSING"]);
const WINDOW_DAYS = 14;

function volumeOf(settlements: readonly SettlementDto[]): {
  value: string;
  hint: string;
} {
  const completed = settlements.filter(
    (settlement) => settlement.state === "SUCCESS" || settlement.state === "SETTLED",
  );
  const amounts = completed
    .map((settlement) => settlement.settlementAmount)
    .filter((amount) => amount !== null);
  const asset = dominantAsset(amounts);
  if (asset === undefined) return { value: "—", hint: "No completed payments yet." };

  const counted = amounts.filter((a) => a.asset === asset).length;
  const skipped = amounts.length - counted;
  return {
    value: display(totalIn(amounts, asset)),
    hint:
      skipped === 0
        ? `Across ${counted} completed payment${counted === 1 ? "" : "s"}.`
        : `${counted} completed in ${asset}. ${skipped} in another currency, not added.`,
  };
}

/** One network's holding of the settlement asset, for the balance card. */
interface ChainHolding {
  readonly chain: string;
  readonly amount: bigint;
}

/**
 * What the merchant holds right now, per network and in total.
 *
 * Only the settlement asset is added. A chain row also reports whatever else
 * that address happens to hold, and adding USDC to ETH would be a number the
 * ledger would not recognise.
 *
 * Chains with no address are dropped rather than counted as zero: the
 * deployment lists every chain it settles on, and a merchant who has not been
 * provisioned there has no balance to report, not a balance of nothing.
 */
function holdingsOf(
  rows: readonly ChainBalanceDto[],
  asset: string | undefined,
): { readonly total: bigint; readonly chains: readonly ChainHolding[] } {
  if (asset === undefined || !isAssetCode(asset)) return { total: 0n, chains: [] };

  const chains = rows
    .filter((row) => row.address !== null)
    .map((row) => ({
      chain: row.chain,
      amount: BigInt(row.balances.find((balance) => balance.asset === asset)?.amount ?? "0"),
    }));

  return { total: chains.reduce((sum, row) => sum + row.amount, 0n), chains };
}

/**
 * The dollar-pegged stablecoins, where showing a balance as `$` is a fact
 * rather than a conversion.
 *
 * EURC is deliberately absent. `EURC/USDC` is a real exchange rate — the
 * EUR/USD one — and rendering a euro balance with a dollar sign would state a
 * number nobody quoted. A merchant settling EURC sees EURC.
 */
const DOLLAR_PEGGED = new Set(["USDC", "USDT"]);

/**
 * A stablecoin balance written the way a merchant thinks about it.
 *
 * `8,395096 USDC` is the ledger's answer and an awkward thing to read at a
 * glance. Rescaled to two decimals it is `$ 8,39` — the same money, at the
 * precision a balance is actually read at. Truncated rather than rounded,
 * because a balance shown as more than it is invites a withdrawal that fails.
 */
function balanceDisplay(total: bigint, asset: string): string {
  if (!isAssetCode(asset)) return "—";
  if (!DOLLAR_PEGGED.has(asset)) return formatMoneyLocale(money(total, asset));

  const scale = 10n ** BigInt(assetDecimals(asset) - assetDecimals("USD"));
  return formatMoneyLocale(money(total / scale, "USD"));
}

/**
 * Balance over the last fourteen days, walked backwards from today.
 *
 * There is no balance history to read: a chain reports what an address holds
 * now and nothing about what it held on Tuesday. So it is reconstructed —
 * yesterday's balance is today's, minus what settled in since, plus what was
 * withdrawn out. Both movements are recorded, which is what makes the walk
 * exact rather than a guess.
 *
 * A withdrawal in another asset is skipped rather than subtracted: it left a
 * different balance than the one being charted.
 */
function balanceHistory(
  current: bigint,
  asset: string,
  settlements: readonly SettlementDto[],
  withdrawals: readonly WalletWithdrawalDto[],
): readonly { date: string; balance: bigint }[] {
  const days = recentDays(WINDOW_DAYS);
  const inflow = new Map<string, bigint>();
  const outflow = new Map<string, bigint>();

  for (const settlement of settlements) {
    const net = settlement.netAmount;
    const settled = settlement.state === "SUCCESS" || settlement.state === "SETTLED";
    if (!settled || net === null || net.asset !== asset) continue;
    const day = (settlement.completedAt ?? settlement.updatedAt).slice(0, 10);
    inflow.set(day, (inflow.get(day) ?? 0n) + BigInt(net.amount));
  }
  for (const withdrawal of withdrawals) {
    if (withdrawal.amount.asset !== asset) continue;
    const day = withdrawal.completedAt.slice(0, 10);
    outflow.set(day, (outflow.get(day) ?? 0n) + BigInt(withdrawal.amount.amount));
  }

  // Backwards from today, then reversed: each earlier day undoes the movements
  // of the day after it.
  const history: { date: string; balance: bigint }[] = [];
  let balance = current;
  for (const day of [...days].reverse()) {
    history.push({ date: day, balance });
    balance = balance - (inflow.get(day) ?? 0n) + (outflow.get(day) ?? 0n);
  }
  return history.reverse();
}

/** The last `count` UTC days, oldest first, including today. */
function recentDays(count: number): readonly string[] {
  const today = new Date();
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - (count - 1 - i));
    return day.toISOString().slice(0, 10);
  });
}

/** Completed movements per day, for the pay-in and pay-out sparklines. */
function dailyTotals(
  entries: readonly { day: string; amount: bigint }[],
): readonly { date: string; total: bigint }[] {
  const byDay = new Map<string, bigint>();
  for (const entry of entries) byDay.set(entry.day, (byDay.get(entry.day) ?? 0n) + entry.amount);
  return recentDays(WINDOW_DAYS).map((date) => ({ date, total: byDay.get(date) ?? 0n }));
}

/**
 * What the merchant holds, where it is held, and how it got there.
 *
 * The figure a merchant opens this page for, so it is the first thing on it and
 * it is a card rather than a cell in a grid — a balance with a shape behind it
 * answers "and is that going up" without a second page.
 *
 * The networks sit on the right with their own amounts. One total across two
 * chains is not a thing a merchant can spend: money on Arc cannot pay a bill on
 * Base, and a single figure implies it can.
 */
function BalanceOverview({
  total,
  asset,
  chains,
  history,
}: {
  total: bigint;
  asset: string | undefined;
  chains: readonly ChainHolding[];
  history: readonly { date: string; balance: bigint }[];
}) {
  if (asset === undefined) {
    return (
      <Card className="gap-2">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">Balance</span>
        <span className="font-medium text-2xl text-foreground">—</span>
        <span className="text-subtle-foreground text-xs">No settlement asset configured.</span>
      </Card>
    );
  }

  const points: Plot[] = history.map((day) => ({
    date: day.date,
    value: Number(day.balance),
    label: balanceDisplay(day.balance, asset),
    detail: "Balance at end of day",
  }));

  return (
    <Card className="gap-5">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs uppercase tracking-wide">Balance</span>
          <span className="font-medium text-4xl text-foreground tracking-tight">
            {balanceDisplay(total, asset)}
          </span>
          <span className="text-subtle-foreground text-xs">
            {chains.length === 0
              ? "No settlement address yet."
              : `Held in ${asset} across ${chains.length} network${chains.length === 1 ? "" : "s"}.`}
          </span>
        </div>

        {/* The marks alone. A per-chain figure beside them read as a
            reconciliation nobody asked for, and the sentence under the total
            already says how many networks it is spread over. */}
        <ChainStack chains={chains.map((holding) => holding.chain)} size={24} />
      </div>

      <TrendChart
        points={points}
        formatTick={(value) => balanceDisplay(BigInt(Math.round(value)), asset)}
        className="h-40"
      />
    </Card>
  );
}

/**
 * A section's fourteen days, as a sparkline and a total.
 *
 * No axes: at this size they would be most of the picture, and the number
 * beside them is the figure anyone reads. "View more" goes to the analytics
 * page, where the same two sections are drawn in full with their status and
 * completion time beside them.
 */
function MovementCard({
  title,
  hint,
  points,
  asset,
  href,
}: {
  title: string;
  hint: string;
  points: readonly { date: string; total: bigint }[];
  asset: string | undefined;
  href: string;
}) {
  const total = points.reduce((sum, point) => sum + point.total, 0n);
  const formatted =
    asset === undefined || !isAssetCode(asset) ? "—" : formatMoneyLocale(money(total, asset));

  return (
    <Card className="gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground text-sm">{title}</span>
          <span className="font-medium text-2xl text-foreground">{formatted}</span>
          <span className="text-subtle-foreground text-xs">{hint}</span>
        </div>
        <a
          href={href}
          className="shrink-0 text-muted-foreground text-xs underline decoration-input underline-offset-2 hover:text-foreground hover:decoration-foreground"
        >
          View more
        </a>
      </div>

      <TrendChart
        points={points.map((point) => ({
          date: point.date,
          value: Number(point.total),
          label:
            asset === undefined || !isAssetCode(asset)
              ? "—"
              : formatMoneyLocale(money(point.total, asset)),
          detail: title,
        }))}
        formatTick={() => ""}
        className="h-20"
        showAxes={false}
      />
    </Card>
  );
}

function Overview() {
  const analytics = useAnalytics();
  const balance = useWalletBalance();
  const withdrawals = useWalletWithdrawalHistory();
  const settings = useSettings();

  return match(analytics)
    .with({ status: "pending" }, () => (
      <div role="status" aria-live="polite" className="flex flex-col gap-8">
        <span className="sr-only">Loading overview</span>
        <StatGridSkeleton />
        <TableSkeleton rows={6} />
      </div>
    ))
    .with({ status: "error" }, ({ error }) => (
      <QueryError
        message={error instanceof ApiError ? error.message : "Failed to load the overview"}
        retry={() => void analytics.refetch()}
        retrying={analytics.isFetching}
      />
    ))
    .with({ status: "success" }, ({ data }) => {
      const all = data.payments;
      const completed = all.filter((p) => p.status === "COMPLETED").length;
      const pending = all.filter((p) => IN_PROGRESS.has(p.status)).length;
      const volume = volumeOf(data.settlements);
      const settlementAsset = settings.data?.settings.settlementAsset;
      const payInAsset = dominantAsset(
        all.filter((payment) => payment.status === "COMPLETED").map((payment) => payment.amount),
      );
      const holdings = holdingsOf(balance.data?.balances ?? [], settlementAsset);
      const history =
        settlementAsset === undefined
          ? []
          : balanceHistory(
              holdings.total,
              settlementAsset,
              data.settlements,
              withdrawals.data?.withdrawals ?? [],
            );
      const recent = all.slice(0, 5);

      const payInDaily = dailyTotals(
        all
          .filter((payment) => payment.status === "COMPLETED")
          .map((payment) => ({
            day: payment.createdAt.slice(0, 10),
            amount: BigInt(payment.amount.amount),
          })),
      );
      const payOutDaily = dailyTotals(
        data.settlements
          .filter((row) => row.state === "SUCCESS" || row.state === "SETTLED")
          .flatMap((row) =>
            row.netAmount === null
              ? []
              : [
                  {
                    day: (row.completedAt ?? row.updatedAt).slice(0, 10),
                    amount: BigInt(row.netAmount.amount),
                  },
                ],
          ),
      );

      return (
        <div className="flex flex-col gap-8">
          <BalanceOverview
            total={holdings.total}
            asset={settlementAsset}
            chains={holdings.chains}
            history={history}
          />

          {/* Four across now: the balance has its own card above, where it can
              carry a chart and the networks it is spread over. Leaving it here
              as well would state the same figure twice on one screen. */}
          <StatGrid className="xl:grid-cols-4">
            <Stat
              label="Payments"
              value={String(all.length)}
              hint="Across all payments."
              icon={<ReceiptIcon size={24} weight="regular" aria-hidden="true" />}
            />
            <Stat
              label="Completed"
              value={String(completed)}
              icon={
                <CheckCircleIcon
                  size={24}
                  weight="regular"
                  aria-hidden="true"
                  className="text-success"
                />
              }
              hint={
                all.length === 0
                  ? "Nothing yet."
                  : `${Math.round((completed / all.length) * 100)}% of all payments.`
              }
            />
            <Stat
              label="In progress"
              value={String(pending)}
              hint="Created, confirmed or processing."
              icon={
                <HourglassMediumIcon
                  size={24}
                  weight="regular"
                  aria-hidden="true"
                  className="text-warning"
                />
              }
            />
            <Stat
              label="Volume"
              value={volume.value}
              hint={volume.hint}
              icon={<CoinsIcon size={24} weight="regular" aria-hidden="true" />}
            />
          </StatGrid>

          <div className="grid gap-4 lg:grid-cols-2">
            <MovementCard
              title="Pay ins"
              hint="What buyers were charged, over the last fourteen days."
              points={payInDaily}
              asset={payInAsset}
              href="/analytics"
            />
            <MovementCard
              title="Pay outs"
              hint="What reached you, net of fee, over the last fourteen days."
              points={payOutDaily}
              asset={settlementAsset}
              href="/analytics"
            />
          </div>

          <section className="flex flex-col gap-3">
            <SectionHeader
              title="Recent payments"
              action={
                <a
                  href="/payments"
                  className="text-xs text-muted-foreground underline decoration-input underline-offset-2 hover:text-foreground hover:decoration-foreground"
                >
                  View all
                </a>
              }
            />

            {recent.length === 0 ? (
              <Empty>
                <EmptyMedia>
                  <ReceiptIcon size={ICON_CARD} aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No payments yet.</EmptyTitle>
                <EmptyDescription>
                  Create a checkout link to take your first payment.
                </EmptyDescription>
                <EmptyAction>
                  <a href="/links" className={buttonVariants()}>
                    Create a payment link
                  </a>
                </EmptyAction>
              </Empty>
            ) : (
              <Table>
                <TableCaption>The five most recent payments</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted">
                      <TableCell>
                        <a
                          href={`/payments/${encodeURIComponent(p.id)}`}
                          className="font-mono text-xs text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                        >
                          {p.id}
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge variant={toneOf(p.status)}>{intentStatusLabel(p.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{p.amount.display}</TableCell>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={isoAttr(p.createdAt)}>{formatDateTime(p.createdAt)}</time>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      );
    })
    .exhaustive();
}

export default withQuery(Overview);
