/**
 * Overview — a React island summarising the merchant's real payment data.
 *
 * Headline figures use the complete, unpaginated analytics read. Volume is
 * settlement volume rather than the customer's payment currency, so it is
 * reported in the asset the merchant receives (USDC for a USDC merchant).
 */

import { isAssetCode } from "@mayarin/shared/asset";
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
import { useAnalytics } from "@/hooks/analytics";
import { useSettings, useWalletBalance } from "@/hooks/settings";
import { ApiError } from "@/lib/api/client";
import { intentStatusLabel, toneOf } from "@/lib/clearing";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { display, dominantAsset, totalIn } from "@/lib/money";
import { withQuery } from "@/lib/with-query";
import type { ChainBalanceDto } from "@/types/settings";
import type { SettlementDto } from "@/types/settlement";

const IN_PROGRESS = new Set(["CREATED", "CONFIRMED", "PROCESSING"]);

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

/**
 * What the merchant holds right now, summed across every network they settle on.
 *
 * Only the settlement asset is added. A chain row also reports whatever else
 * that address happens to hold, and adding USDC to ETH would be a number the
 * ledger would not recognise — the same reason the settlement page names its
 * asset beside the figure rather than implying one.
 *
 * Chains with no address are dropped rather than counted as zero: the
 * deployment lists every chain it settles on, and a merchant who has not been
 * provisioned there has no balance to report, not a balance of nothing.
 */
function settlementBalanceOf(
  rows: readonly ChainBalanceDto[],
  asset: string | undefined,
): { readonly value: string; readonly hint: string; readonly chains: readonly string[] } {
  if (asset === undefined || !isAssetCode(asset)) {
    return { value: "—", hint: "No settlement asset configured.", chains: [] };
  }

  const funded = rows.filter((row) => row.address !== null);
  const total = funded.reduce((sum, row) => {
    const held = row.balances.find((balance) => balance.asset === asset);
    return held === undefined ? sum : sum + BigInt(held.amount);
  }, 0n);

  const chains = funded.map((row) => row.chain);
  return {
    value: formatMoneyLocale(money(total, asset)),
    hint:
      chains.length === 0
        ? "No settlement address yet."
        : `Across ${chains.length} network${chains.length === 1 ? "" : "s"}.`,
    chains,
  };
}

function Overview() {
  const analytics = useAnalytics();
  const balance = useWalletBalance();
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
      const held = settlementBalanceOf(
        balance.data?.balances ?? [],
        settings.data?.settings.settlementAsset,
      );
      const recent = all.slice(0, 5);

      return (
        <div className="flex flex-col gap-8">
          {/* Five across on a wide screen, and the balance leads: it is the
              only figure that answers "how much do I have right now", which is
              what a merchant opens this page to find. The four behind it
              explain how it got there. On a narrow screen it spans the pair so
              it reads as the headline rather than sharing a row. */}
          <StatGrid className="xl:grid-cols-5">
            {/* The networks stand in for this cell's icon rather than sitting
                beside one: two graphics competing in a 24px row reads as
                clutter, and the stack is the more informative of the two. */}
            <Stat
              className="sm:col-span-2 xl:col-span-1"
              label="Balance"
              value={held.value}
              hint={held.hint}
              icon={held.chains.length > 0 ? <ChainStack chains={held.chains} /> : undefined}
            />
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
