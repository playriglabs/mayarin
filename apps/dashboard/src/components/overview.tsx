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
  MinusIcon,
  ReceiptIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";
import { ChainStack } from "@/components/chain-logo";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryError } from "@/components/ui/query-error";
import {
  BalanceCardSkeleton,
  MovementCardSkeleton,
  RecentListSkeleton,
  StatGridSkeleton,
} from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { type Plot, TrendBars, TrendChart } from "@/components/ui/trend-chart";
import { useAnalytics } from "@/hooks/analytics";
import { useSettings, useWalletBalance, useWalletWithdrawalHistory } from "@/hooks/settings";
import { payInAmountUsd, settlementsByPaymentIntent } from "@/lib/analytics-movements";
import { ApiError } from "@/lib/api/client";
import { intentStatusLabel, toneOf } from "@/lib/clearing";
import { ICON_CARD } from "@/lib/icons";
import { display, dominantAsset, totalIn } from "@/lib/money";
import { COUNT_UP_DURATION, EASE_OUT_EXPO } from "@/lib/motion";
import { withQuery } from "@/lib/with-query";
import type { PaymentIntentDto } from "@/types/payment";
import type { ChainBalanceDto, WalletWithdrawalDto } from "@/types/settings";
import type { SettlementDto } from "@/types/settlement";

const IN_PROGRESS = new Set(["CREATED", "CONFIRMED", "PROCESSING"]);
/** The movement cards' window, matching the analytics page they link to. */
const MOVEMENT_DAYS = 30;
/**
 * The balance's window, deliberately longer.
 *
 * A balance moves on settlement and withdrawal rather than on trading, so two
 * weeks of it is often one step and a flat line. A month is enough to show a
 * shape without becoming a chart nobody reads the middle of.
 */
const BALANCE_DAYS = 30;

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
  const total = totalIn(amounts, asset);
  return {
    value: DOLLAR_PEGGED.has(asset)
      ? approximateDollarDisplay(total.amount, asset)
      : display(total),
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

/** A dollar-pegged volume at dashboard precision, marked as an approximation. */
function approximateDollarDisplay(total: bigint, asset: string): string {
  if (!isAssetCode(asset)) return "—";
  const scale = 10n ** BigInt(assetDecimals(asset) - assetDecimals("USD"));
  const digits = formatMoneyLocale(money(total / scale, "USD"), { symbol: false });
  return `≈ $${digits}`;
}

/**
 * Balance over the last thirty days, walked backwards from today.
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
  const days = recentDays(BALANCE_DAYS);
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
  //
  // Clamped at zero, and the clamp is load-bearing rather than defensive. The
  // walk starts from what the *current* settlement address holds and subtracts
  // every settlement in the window — including ones paid to an address the
  // merchant has since replaced, which this balance never contained. Changing a
  // settlement address makes that immediate: today's holding is the new
  // address's, the history is the old one's, and the difference drives the walk
  // below zero. A negative balance is not a thing a merchant ever held, so the
  // floor is nothing.
  const history: { date: string; balance: bigint }[] = [];
  let balance = current;
  for (const day of [...days].reverse()) {
    history.push({ date: day, balance });
    const previous = balance - (inflow.get(day) ?? 0n) + (outflow.get(day) ?? 0n);
    balance = previous > 0n ? previous : 0n;
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
  return recentDays(MOVEMENT_DAYS).map((date) => ({ date, total: byDay.get(date) ?? 0n }));
}

/**
 * Today's sales, from a daily series that ends today.
 *
 * Reads the pay-out series: what reached the merchant, net of fee, in the
 * settlement asset — the same figures as the Pay outs card, so the indicator
 * and the chart below it never disagree. Days are UTC, like every chart on the
 * page, so the figure starts over each day.
 */
export function todaySales(daily: readonly { date: string; total: bigint }[]): bigint {
  return daily[daily.length - 1]?.total ?? 0n;
}

/**
 * A figure that counts to its new value rather than cutting to it.
 *
 * Counts only on a change, not on first render: the refresh tick lands every few
 * seconds, and a balance that climbed from zero on every page load would narrate
 * money that did not just arrive. A change mid-count starts from what is on
 * screen, so the number never jumps back. Interpolated in thousandths of the
 * difference as a `bigint`, so the last frame is the value exactly.
 */
function useCountUp(value: bigint): bigint {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const from = shownRef.current;
    if (from === value) return;

    const show = (next: bigint) => {
      shownRef.current = next;
      setShown(next);
    };
    if (reduced) {
      show(value);
      return;
    }

    const controls = animate(0, 1, {
      duration: COUNT_UP_DURATION,
      ease: EASE_OUT_EXPO,
      onUpdate: (progress) =>
        show(from + ((value - from) * BigInt(Math.round(progress * 1000))) / 1000n),
    });
    return () => controls.stop();
  }, [value, reduced]);

  return shown;
}

/**
 * The line beside the balance: what came in today.
 *
 * Today only, with no comparison: a figure against yesterday reads as a fall
 * every morning, when most of the day has not happened yet. A day with no sales
 * yet says so plainly rather than showing `+$ 0,00`.
 */
function TodayIndicator({ total, asset }: { total: bigint; asset: string }) {
  const shown = useCountUp(total);

  if (total === 0n) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
        <MinusIcon size={14} weight="bold" aria-hidden="true" />
        No sales yet today
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-success text-xs">
      <TrendUpIcon size={16} weight="bold" aria-hidden="true" />+{balanceDisplay(shown, asset)}{" "}
      today
    </span>
  );
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
  today,
}: {
  total: bigint;
  asset: string | undefined;
  chains: readonly ChainHolding[];
  history: readonly { date: string; balance: bigint }[];
  today: bigint;
}) {
  const shownTotal = useCountUp(total);

  if (asset === undefined) {
    return (
      <Card className="gap-2">
        <span className="text-muted-foreground text-xs tracking-wide">Balance</span>
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
        <div className="flex flex-col gap-3">
          <span className="text-muted-foreground text-xs tracking-wide">Balance</span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1">
            <span className="font-medium text-[30px] text-foreground tracking-tight">
              {balanceDisplay(shownTotal, asset)}
            </span>
            <TodayIndicator total={today} asset={asset} />
          </div>
          <span className="text-subtle-foreground text-xs">
            {chains.length === 0
              ? "No settlement address yet."
              : `Held in ${asset} across ${chains.length} network${chains.length === 1 ? "" : "s"}.`}
          </span>
        </div>

        {/* The marks alone. A per-chain figure beside them read as a
            reconciliation nobody asked for, and the sentence under the total
            already says how many networks it is spread over. */}
        {/* `chains` retains the order returned by `/wallets/balance`, whose
            configured settlement-chain order is the source of truth. */}
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
 * A section's thirty days, as a sparkline and a total.
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
  const hasMovement = total > 0n;
  // `balanceDisplay`, not the raw locale format: a settlement figure belongs in
  // the same money as the balance above it, and `8,375196 USDC` beside `$ 8,39`
  // is one page quoting itself two ways.
  const formatted = !hasMovement || asset === undefined ? "—" : balanceDisplay(total, asset);

  return (
    <Card className="gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="font-medium text-foreground text-sm">{title}</span>
          <span className="font-medium text-2xl text-foreground">{formatted}</span>
          <span className="text-subtle-foreground text-xs mt-1">{hint}</span>
        </div>
        <a
          href={href}
          className="shrink-0 text-muted-foreground text-xs underline decoration-input underline-offset-2 hover:text-foreground hover:decoration-foreground"
        >
          View more
        </a>
      </div>

      {/* `dailyTotals` deliberately fills the thirty-day window with zeroes,
          so `points.length` cannot distinguish no activity from real data.
          An all-zero chart adds only a misleading baseline and hover dates. */}
      {hasMovement && (
        <TrendBars
          points={points.map((point) => ({
            date: point.date,
            value: Number(point.total),
            label: asset === undefined ? "—" : balanceDisplay(point.total, asset),
            detail: title,
          }))}
          formatTick={() => ""}
          className="h-20"
          showAxes={false}
        />
      )}
    </Card>
  );
}

/**
 * The five most recent payments, as a column rather than a table.
 *
 * A table needs four columns to say what it knows and this sits in a third of
 * the width, so it drops to what a merchant scans for: which payment and whether
 * it landed. The full table is one link away and still has the amount, the
 * created time, the reference and the rest.
 *
 * The id is truncated from the left. A payment id is a ULID whose leading
 * characters are a timestamp shared by everything created the same
 * millisecond — the tail is the part that tells two of them apart.
 */
function RecentPayments({ payments }: { payments: readonly PaymentIntentDto[] }) {
  return (
    <Card className="gap-4">
      <div className="flex items-center justify-between gap-4">
        <span className="font-medium text-foreground text-sm">Recent payments</span>
        <a
          href="/payments"
          className="shrink-0 text-muted-foreground text-xs underline decoration-input underline-offset-2 hover:text-foreground hover:decoration-foreground"
        >
          View all
        </a>
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8 text-center">
          <ReceiptIcon size={ICON_CARD} aria-hidden="true" className="text-subtle-foreground" />
          <span className="text-muted-foreground text-xs">No payments yet.</span>
          <a href="/links" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Create a payment link
          </a>
        </div>
      ) : (
        <ul className="flex flex-col">
          {payments.map((payment) => (
            <li
              key={payment.id}
              className="flex items-center justify-between gap-3 border-border border-b py-2.5 last:border-b-0 last:pb-0 first:pt-0"
            >
              <a
                href={`/payments/${encodeURIComponent(payment.id)}`}
                title={payment.id}
                className="inline-flex min-w-0 flex-1 items-center gap-1.5 font-mono text-foreground text-xs underline decoration-input underline-offset-2 hover:decoration-foreground"
              >
                <ReceiptIcon size={12} aria-hidden="true" className="shrink-0" />
                <span dir="rtl" className="min-w-0 truncate">
                  {payment.id}
                </span>
              </a>
              <span className="shrink-0">
                <Badge variant={toneOf(payment.status)}>{intentStatusLabel(payment.status)}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
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
      // The page's own shape, in the order it will be read: the balance beside
      // the recent list, the four stats, then the two movement cards. A
      // skeleton that does not match is a layout that rearranges itself under
      // the reader.
      <div role="status" aria-live="polite" className="flex flex-col gap-8">
        <span className="sr-only">Loading overview</span>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <BalanceCardSkeleton />
          </div>
          <RecentListSkeleton />
        </div>
        <StatGridSkeleton />
        <div className="grid gap-4 lg:grid-cols-2">
          <MovementCardSkeleton />
          <MovementCardSkeleton />
        </div>
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
      const settlementsByIntent = settlementsByPaymentIntent(data.settlements);
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
      const recent = all.slice(0, 6);

      const payInDaily = dailyTotals(
        all
          .map((payment) => ({
            payment,
            amount: payInAmountUsd(payment, settlementsByIntent.get(payment.id)),
          }))
          .flatMap(({ payment, amount }) =>
            amount === null ? [] : [{ day: payment.createdAt.slice(0, 10), amount }],
          ),
      );
      const payOutDaily = dailyTotals(
        data.settlements
          .filter((row) => row.state === "SUCCESS" || row.state === "SETTLED")
          .flatMap((row) =>
            row.netAmount === null || row.netAmount.asset !== settlementAsset
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
          {/* The two things a merchant opens this page for, side by side and
              in the order they ask them: how much do I have, and what just
              came in. The balance takes two thirds because it carries a chart;
              the list is a column of rows and does not want the width. */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              {/* The balance reads RPC state per chain, so it can still be on
                  its way when the analytics rows have landed. The skeleton is
                  the card's own shape — same figure line, same h-40 chart box —
                  so nothing jumps when the numbers arrive. */}
              {balance.isPending ? (
                <div role="status" aria-live="polite">
                  <span className="sr-only">Loading balance</span>
                  <BalanceCardSkeleton />
                </div>
              ) : (
                <BalanceOverview
                  total={holdings.total}
                  asset={settlementAsset}
                  chains={holdings.chains}
                  history={history}
                  today={todaySales(payOutDaily)}
                />
              )}
            </div>
            <RecentPayments payments={recent} />
          </div>

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
              hint="Gross USD value at the locked rate, over the last thirty days."
              points={payInDaily}
              asset="USD"
              href="/analytics"
            />
            <MovementCard
              title="Pay outs"
              hint="What reached you, net of fee, over the last thirty days."
              points={payOutDaily}
              asset={settlementAsset}
              href="/analytics"
            />
          </div>
        </div>
      );
    })
    .exhaustive();
}

export default withQuery(Overview);
