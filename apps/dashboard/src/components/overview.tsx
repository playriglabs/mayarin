/**
 * Overview — a React island summarising the merchant's real payment data.
 *
 * Headline figures use the complete, unpaginated analytics read. Volume is
 * settlement volume rather than the customer's payment currency, so it is
 * reported in the asset the merchant receives (USDC for a USDC merchant).
 */

import {
  CheckCircleIcon,
  CoinsIcon,
  HourglassMediumIcon,
  ReceiptIcon,
} from "@phosphor-icons/react";
import { match } from "ts-pattern";
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
import { ApiError } from "@/lib/api/client";
import { intentStatusLabel, toneOf } from "@/lib/clearing";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { display, dominantAsset, totalIn } from "@/lib/money";
import { withQuery } from "@/lib/with-query";
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

function Overview() {
  const analytics = useAnalytics();

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
      const recent = all.slice(0, 5);

      return (
        <div className="flex flex-col gap-8">
          <StatGrid>
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
