/**
 * Settlement status — a React island over fixture data.
 *
 * There is no settlement endpoint on the dashboard API yet, so this reads
 * `lib/fixtures`. The shapes match what the indexer already derives from the
 * `PaymentCompleted` event, so the swap to a real endpoint is a change of data
 * source rather than of layout.
 *
 * The settlement address is shown in full and never truncated in the DOM. An
 * address a merchant cannot copy whole is worse than one they have to scroll.
 */

import { formatMoneyLocale } from "@mayarin/shared/locale";
import { money } from "@mayarin/shared/money";
import {
  ArrowSquareOutIcon,
  BankIcon,
  CheckCircleIcon,
  ClockIcon,
  WalletIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Stat } from "@/components/ui/stat";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, isoAttr } from "@/lib/date";
import {
  SETTLEMENT_ADDRESS,
  SETTLEMENT_ASSET,
  SETTLEMENT_CHAIN,
  SETTLEMENTS,
  type SettlementStatus,
} from "@/lib/fixtures";
import { ICON_CARD } from "@/lib/icons";

const STATUS_VARIANT: Readonly<Record<SettlementStatus, "success" | "warning" | "destructive">> = {
  settled: "success",
  in_flight: "warning",
  failed: "destructive",
};

const STATUS_LABEL: Readonly<Record<SettlementStatus, string>> = {
  settled: "Settled",
  in_flight: "In flight",
  failed: "Failed",
};

/** Shortened for display only — the full value stays in the `title`. */
function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export default function Settlement() {
  const settled = SETTLEMENTS.filter((s) => s.status === "settled");
  const inFlight = SETTLEMENTS.filter((s) => s.status === "in_flight");
  const failed = SETTLEMENTS.filter((s) => s.status === "failed");

  const netTotal = settled.reduce((acc, s) => acc + s.net, 0n);
  const feeTotal = settled.reduce((acc, s) => acc + s.fee, 0n);

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <CardTitle>
          <WalletIcon
            size={ICON_CARD}
            weight="regular"
            aria-hidden="true"
            className="text-subtle-foreground"
          />
          Settlement destination
        </CardTitle>
        <dl className="flex flex-col gap-3 sm:flex-row sm:gap-8">
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-xs text-subtle-foreground">Address</dt>
            <dd className="font-mono text-xs break-all text-foreground">{SETTLEMENT_ADDRESS}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-subtle-foreground">Asset</dt>
            <dd className="text-sm text-foreground">{SETTLEMENT_ASSET}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-xs text-subtle-foreground">Chain</dt>
            <dd className="text-sm text-foreground">{SETTLEMENT_CHAIN}</dd>
          </div>
        </dl>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Settled"
          value={formatMoneyLocale(money(netTotal, SETTLEMENT_ASSET))}
          hint={`Net across ${settled.length} settlement${settled.length === 1 ? "" : "s"}.`}
          icon={CheckCircleIcon}
        />
        <Stat
          label="Fees taken"
          value={formatMoneyLocale(money(feeTotal, SETTLEMENT_ASSET))}
          hint="Split on chain, not held by Mayarin."
          icon={BankIcon}
        />
        <Stat
          label="In flight"
          value={String(inFlight.length)}
          hint="Broadcast, awaiting finality."
          icon={ClockIcon}
        />
        <Stat
          label="Failed"
          value={String(failed.length)}
          hint={failed.length === 0 ? "Nothing to retry." : "Needs attention."}
          icon={WarningCircleIcon}
        />
      </div>

      <Card className="flex flex-col gap-4">
        <CardTitle>
          <BankIcon
            size={ICON_CARD}
            weight="regular"
            aria-hidden="true"
            className="text-subtle-foreground"
          />
          Settlements
        </CardTitle>
        {SETTLEMENTS.length === 0 ? (
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
                <TableHead>Transaction</TableHead>
                <TableHead>Settled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SETTLEMENTS.map((s) => (
                <TableRow key={s.id} className="hover:bg-muted">
                  <TableCell>
                    <a
                      href={`/payments/${encodeURIComponent(s.paymentId)}`}
                      className="font-mono text-xs text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                    >
                      {s.paymentId}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {formatMoneyLocale(money(s.net, s.asset))}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatMoneyLocale(money(s.fee, s.asset))}
                  </TableCell>
                  <TableCell>
                    {s.txHash === null ? (
                      <span className="text-xs text-subtle-foreground">Not broadcast</span>
                    ) : (
                      <span
                        title={s.txHash}
                        className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground"
                      >
                        {shortHash(s.txHash)}
                        <ArrowSquareOutIcon
                          size={12}
                          aria-hidden="true"
                          className="text-subtle-foreground"
                        />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.settledAt === null ? (
                      <span className="text-xs text-subtle-foreground">—</span>
                    ) : (
                      <time dateTime={isoAttr(s.settledAt)}>{formatDateTime(s.settledAt)}</time>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
