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

import {
  ArrowSquareOutIcon,
  BankIcon,
  HourglassMediumIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { match } from "ts-pattern";
import { AssetAmount, AssetLabel } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CursorPagination } from "@/components/ui/cursor-pagination";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { QueryError } from "@/components/ui/query-error";
import { SectionHeader } from "@/components/ui/section-header";
import {
  SettlementDestinationSkeleton,
  StatGridSkeleton,
  TableSkeleton,
} from "@/components/ui/skeleton";
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
import { useCursorPagination } from "@/hooks/cursor-pagination";
import { useSettings } from "@/hooks/settings";
import { useSettlements } from "@/hooks/settlements";
import { ApiError } from "@/lib/api/client";
import { shortHash } from "@/lib/chain-explorer";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { PAGE_SIZE } from "@/lib/pagination";
import { withQuery } from "@/lib/with-query";
import type { SettlementDto } from "@/types/settlement";

function toneOf(state: string): "success" | "destructive" | "warning" {
  if (state === "SUCCESS" || state === "SETTLED") return "success";
  return state === "FAILED" ? "destructive" : "warning";
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load settlements";
}

function settingsReasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load settlement destination";
}

/**
 * The network a settlement ran on.
 *
 * The settlement log's chain when the indexer saw one, the payer's rail
 * otherwise. Reading only the log left every deposit-match payment blank: that
 * path settles through the adapter and emits no `PaymentCompleted` to index,
 * so there is no log — but the payment plainly still ran on a network. Neither
 * present is a payment that never chose a rail, and stays a dash.
 */
function NetworkCell({ row }: { readonly row: SettlementDto }) {
  const network = row.chain?.chain ?? row.payment?.chain ?? null;
  if (network === null) return <span className="text-subtle-foreground">—</span>;
  return <ChainLabel chain={network} size={18} className="text-sm" />;
}

function Settlement() {
  const pagination = useCursorPagination();
  const settlements = useSettlements(PAGE_SIZE, pagination.cursor);
  const settings = useSettings();

  const rows = settlements.data?.settlements ?? [];
  const summary = settlements.data?.summary;
  const asset = summary?.asset ?? undefined;

  const configured = settings.data?.settings;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <SectionHeader title="Settlement destination" />
        {match(settings)
          .with({ isPending: true }, () => (
            <div role="status">
              <SettlementDestinationSkeleton />
              <span className="sr-only">Loading settlement destination</span>
            </div>
          ))
          .with({ isError: true }, ({ error }) => (
            <QueryError
              message={settingsReasonOf(error)}
              retry={() => void settings.refetch()}
              retrying={settings.isFetching}
            />
          ))
          .otherwise(() => (
            <Card>
              <dl className="flex flex-col gap-3 sm:flex-row sm:gap-8">
                <div className="flex min-w-0 flex-col gap-1">
                  <dt className="text-xs text-subtle-foreground">Address</dt>
                  {/* Never truncated in the DOM: an address a merchant cannot copy
                  whole is worse than one they have to scroll. */}
                  <dd className="font-mono text-sm break-all text-foreground">
                    {configured?.effectiveSettlementAddress ?? "Not set"}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt className="text-xs text-subtle-foreground">Asset</dt>
                  <dd className="text-sm text-foreground">
                    {configured !== undefined && <AssetLabel symbol={configured.settlementAsset} />}
                  </dd>
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
          ))}
      </section>

      {match(settlements)
        .with({ isPending: true }, () => (
          <>
            <StatGridSkeleton />
            <TableSkeleton rows={PAGE_SIZE} />
          </>
        ))
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void settlements.refetch()}
            retrying={settlements.isFetching}
          />
        ))
        .otherwise(() => (
          <>
            <StatGrid>
              <Stat
                label={asset === undefined ? "Settled" : `Settled (${asset})`}
                value={summary?.netAmount?.display ?? "—"}
                hint={`Net across ${summary?.settledCount ?? 0} settlement${summary?.settledCount === 1 ? "" : "s"}.`}
              />
              <Stat
                label={asset === undefined ? "Fees taken" : `Fees taken (${asset})`}
                value={summary?.fee?.display ?? "—"}
                hint="Split at settlement, not held by Mayarin."
              />
              <Stat
                label="In flight"
                value={String(summary?.inFlightCount ?? 0)}
                hint="Priced and on the way."
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
                label="Failed"
                value={String(summary?.failedCount ?? 0)}
                hint={summary?.failedCount === 0 ? "Nothing to retry." : "Needs attention."}
                icon={
                  <WarningCircleIcon
                    size={24}
                    weight="regular"
                    aria-hidden="true"
                    className="text-destructive"
                  />
                }
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
                  <EmptyDescription>
                    Completed payments will settle to the destination above.
                  </EmptyDescription>
                  <EmptyAction>
                    <a href="/links" className={buttonVariants()}>
                      Take your first payment
                    </a>
                  </EmptyAction>
                </Empty>
              ) : (
                <div className="flex flex-col gap-3">
                  <Table>
                    <TableCaption>Settlements to this merchant</TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Payment</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                        <TableHead className="text-right">Fee</TableHead>
                        {/* Beside the reference rather than beside the state:
                            the network and the transaction that settled on it
                            are one fact, and a reference means little without
                            knowing which explorer it belongs to. */}
                        <TableHead>Network</TableHead>
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
                            {row.netAmount === null ? (
                              "—"
                            ) : (
                              <AssetAmount
                                asset={row.netAmount.asset}
                                display={row.netAmount.display}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {row.fee === null ? (
                              "—"
                            ) : (
                              <AssetAmount asset={row.fee.asset} display={row.fee.display} />
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <NetworkCell row={row} />
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
                  <CursorPagination
                    label="Settlement pages"
                    page={pagination.page}
                    canPrevious={pagination.canPrevious}
                    nextCursor={settlements.data?.nextCursor}
                    busy={settlements.isFetching}
                    onPrevious={pagination.previous}
                    onNext={pagination.next}
                  />
                </div>
              )}
            </section>
          </>
        ))}
    </div>
  );
}

export default withQuery(Settlement);
