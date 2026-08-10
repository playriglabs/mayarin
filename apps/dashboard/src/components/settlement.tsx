/**
 * Settlement — a React island over the real `/settlements` endpoint (#15).
 *
 * What the merchant was actually paid, per payment. A settlement is not a
 * record of its own: it is what clearing made of a payment — the locked
 * settlement amount, the fee, the net — plus, on the contract path, what the
 * chain then reported.
 *
 * The totals cover COMPLETED settlements only, and in ONE asset: the one most
 * of them settled in. Adding two settlement assets together without a rate
 * would be a number the ledger would not recognise, so the asset is named next
 * to the figure rather than implied.
 *
 * The destination is read from settings, because "where am I paid" is a
 * question about configuration, not about any one payment — and a merchant
 * whose address is blank is paid at their managed wallet, which the settings
 * surface resolves and this one displays.
 */

import { ArrowSquareOutIcon, BankIcon } from "@phosphor-icons/react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
import { useSettings } from "@/hooks/settings";
import { useSettlements } from "@/hooks/settlements";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { display, dominantAsset, totalIn } from "@/lib/money";
import { withQuery } from "@/lib/with-query";
import type { MoneyDto } from "@/types/payment";
import type { SettlementDto } from "@/types/settlement";

/** Shortened for display only — the full value stays in the `title`. */
function shortHash(hash: string): string {
  return hash.length <= 20 ? hash : `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function toneOf(state: string): "success" | "destructive" | "warning" {
  if (state === "SUCCESS" || state === "SETTLED") return "success";
  return state === "FAILED" ? "destructive" : "warning";
}

/** Only a finished settlement counts towards a total. */
function isPaid(row: SettlementDto): boolean {
  return row.state === "SUCCESS" || row.state === "SETTLED";
}

function moneyValues(
  rows: readonly SettlementDto[],
  pick: (row: SettlementDto) => MoneyDto | null,
) {
  return rows.map(pick).filter((value): value is MoneyDto => value !== null);
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load settlements";
}

function Settlement() {
  const settlements = useSettlements(100);
  const settings = useSettings();

  const rows = settlements.data?.settlements ?? [];
  const paid = rows.filter(isPaid);
  const inFlight = rows.filter((row) => !isPaid(row) && row.state !== "FAILED");
  const failed = rows.filter((row) => row.state === "FAILED");

  const nets = moneyValues(paid, (row) => row.netAmount);
  const fees = moneyValues(paid, (row) => row.fee);
  // One asset, named — the one most settled payments were paid in.
  const asset = dominantAsset(nets);
  const netTotal = asset === undefined ? undefined : totalIn(nets, asset);
  const feeTotal = asset === undefined ? undefined : totalIn(fees, asset);

  const configured = settings.data?.settings;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionHeader title="Settlement destination" />
        <Card>
          <dl className="flex flex-col gap-3 sm:flex-row sm:gap-8">
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-xs text-subtle-foreground">Address</dt>
              {/* Never truncated in the DOM: an address a merchant cannot copy
                  whole is worse than one they have to scroll. */}
              <dd className="font-mono text-xs break-all text-foreground">
                {configured?.effectiveSettlementAddress ?? "Not set"}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-subtle-foreground">Asset</dt>
              <dd className="text-sm text-foreground">{configured?.settlementAsset ?? "—"}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-subtle-foreground">On chain</dt>
              <dd className="text-sm text-foreground">
                <Badge variant={configured?.canSettleOnChain === true ? "success" : "warning"}>
                  {configured?.canSettleOnChain === true ? "Ready" : "No address"}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>
      </section>

      {match(settlements)
        .with({ isPending: true }, () => (
          <>
            <StatGridSkeleton />
            <TableSkeleton rows={4} />
          </>
        ))
        .with({ isError: true }, ({ error }) => (
          <Alert variant="destructive">{reasonOf(error)}</Alert>
        ))
        .otherwise(() => (
          <>
            <StatGrid>
              <Stat
                label={asset === undefined ? "Settled" : `Settled (${asset})`}
                value={netTotal === undefined ? "—" : display(netTotal)}
                hint={`Net across ${paid.length} settlement${paid.length === 1 ? "" : "s"}.`}
              />
              <Stat
                label={asset === undefined ? "Fees taken" : `Fees taken (${asset})`}
                value={feeTotal === undefined ? "—" : display(feeTotal)}
                hint="Split at settlement, not held by Mayarin."
              />
              <Stat
                label="In flight"
                value={String(inFlight.length)}
                hint="Priced and on the way."
              />
              <Stat
                label="Failed"
                value={String(failed.length)}
                hint={failed.length === 0 ? "Nothing to retry." : "Needs attention."}
              />
            </StatGrid>

            <section className="flex flex-col gap-3">
              <SectionHeader title="Settlements" />
              {rows.length === 0 ? (
                <Empty>
                  <EmptyMedia>
                    <BankIcon size={ICON_CARD} aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle>No settlements yet.</EmptyTitle>
                </Empty>
              ) : (
                <Table>
                  <TableCaption>Settlements to this merchant</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Fee</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.clearingTransactionId} className="hover:bg-muted">
                        <TableCell>
                          <a
                            href={`/payments/${encodeURIComponent(row.paymentIntentId)}`}
                            className="font-mono text-xs text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                          >
                            {row.paymentIntentId}
                          </a>
                        </TableCell>
                        <TableCell>
                          <span className="flex gap-1">
                            <Badge variant={toneOf(row.state)}>{row.state}</Badge>
                            {/* A settlement acted on and then reorged away is
                                the one case that needs a human. */}
                            {row.chain !== null && row.chain.orphanedAt !== null && (
                              <Badge variant="destructive">Reorged</Badge>
                            )}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {row.netAmount?.display ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {row.fee?.display ?? "—"}
                        </TableCell>
                        <TableCell>
                          {row.reference === null ? (
                            <span className="text-xs text-subtle-foreground">Not settled</span>
                          ) : (
                            <span
                              title={row.reference}
                              className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground"
                            >
                              {shortHash(row.reference)}
                              <ArrowSquareOutIcon
                                size={12}
                                aria-hidden="true"
                                className="text-subtle-foreground"
                              />
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <time dateTime={isoAttr(row.updatedAt)}>
                            {formatDateTime(row.updatedAt)}
                          </time>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </section>
          </>
        ))}
    </div>
  );
}

export default withQuery(Settlement);
