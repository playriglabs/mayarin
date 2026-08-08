/**
 * Overview — a React island summarising the merchant's real payment data.
 *
 * Every figure here is derived from the same `/payments` page the explorer
 * reads, so the numbers can never disagree with the list behind them. Volume is
 * reported for ONE asset — the one most rows are priced in — and says so,
 * because adding two currencies together without a rate would be a lie the
 * ledger would not recognise.
 */

import { ReceiptIcon } from "@phosphor-icons/react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { SectionHeader } from "@/components/ui/section-header";
import { Skeleton } from "@/components/ui/skeleton";
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
import { usePayments } from "@/hooks/payments";
import { ApiError } from "@/lib/api/client";
import { intentStatusLabel, toneOf } from "@/lib/clearing";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { display, dominantAsset, totalIn } from "@/lib/money";
import { withQuery } from "@/lib/with-query";
import type { PaymentIntentDto } from "@/types/payment";

const IN_PROGRESS = new Set(["CREATED", "CONFIRMED", "PROCESSING"]);

function volumeOf(payments: readonly PaymentIntentDto[]): {
  value: string;
  hint: string;
} {
  const completed = payments.filter((p) => p.status === "COMPLETED");
  const amounts = completed.map((p) => p.amount);
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
  const payments = usePayments(100);

  return match(payments)
    .with({ status: "pending" }, () => (
      <div role="status" aria-live="polite" className="flex flex-col gap-2">
        <span className="sr-only">Loading overview</span>
        <Skeleton aria-hidden="true" />
        <Skeleton aria-hidden="true" />
        <Skeleton aria-hidden="true" />
      </div>
    ))
    .with({ status: "error" }, ({ error }) => (
      <Alert variant="destructive">
        {error instanceof ApiError ? error.message : "Failed to load the overview"}
      </Alert>
    ))
    .with({ status: "success" }, ({ data }) => {
      const all = data.payments;
      const completed = all.filter((p) => p.status === "COMPLETED").length;
      const pending = all.filter((p) => IN_PROGRESS.has(p.status)).length;
      const volume = volumeOf(all);
      const recent = all.slice(0, 5);

      return (
        <div className="flex flex-col gap-8">
          <StatGrid>
            <Stat label="Payments" value={String(all.length)} hint="In the most recent 100." />
            <Stat
              label="Completed"
              value={String(completed)}
              hint={
                all.length === 0
                  ? "Nothing yet."
                  : `${Math.round((completed / all.length) * 100)}% of the window.`
              }
            />
            <Stat
              label="In progress"
              value={String(pending)}
              hint="Created, confirmed or processing."
            />
            <Stat label="Volume" value={volume.value} hint={volume.hint} />
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
