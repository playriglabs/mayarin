/**
 * Mayarin Resolution's queue (#313): every open dispute this deployment
 * arbitrates, nearest `resolveBy` first — the order they must be decided in.
 */

import { chainLabel, shortHash } from "@mayarin/chain";
import { ScalesIcon } from "@phosphor-icons/react";
import { match } from "ts-pattern";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDisputes } from "@/hooks/disputes";
import { ApiError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";

const HOUR_MS = 3_600_000;

/** Amber inside two days, red inside one: the same thresholds the alerts use. */
export function deadlineTone(
  resolveBy: string,
  now = Date.now(),
): "default" | "warning" | "destructive" {
  const left = Date.parse(resolveBy) - now;
  if (left <= 24 * HOUR_MS) return "destructive";
  if (left <= 48 * HOUR_MS) return "warning";
  return "default";
}

function DisputesQueue() {
  const disputes = useDisputes();

  return match(disputes)
    .with({ status: "pending" }, () => <PageLoader label="Loading disputes" />)
    .with({ status: "error" }, ({ error }) => (
      <QueryError
        message={error instanceof ApiError ? error.message : "Failed to load disputes"}
        retry={() => void disputes.refetch()}
        retrying={disputes.isFetching}
      />
    ))
    .with({ status: "success" }, ({ data }) =>
      data.disputes.length === 0 ? (
        <Empty>
          <EmptyMedia>
            <ScalesIcon size={ICON_CARD} aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No open disputes.</EmptyTitle>
          <EmptyDescription>Disputes appear here once a buyer opens one.</EmptyDescription>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dispute</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>Buyer</TableHead>
              <TableHead>Opened</TableHead>
              <TableHead className="text-right">Decide by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.disputes.map((dispute) => (
              <TableRow key={dispute.id}>
                <TableCell>
                  <a
                    href={`/arbitration/${dispute.id}`}
                    className="font-medium underline decoration-input underline-offset-2 hover:decoration-foreground"
                  >
                    #{dispute.reference}
                  </a>
                </TableCell>
                <TableCell className="font-mono text-muted-foreground text-xs">
                  {dispute.paymentIntentId}
                </TableCell>
                <TableCell>{chainLabel(dispute.chain)}</TableCell>
                <TableCell className="font-mono text-xs" title={dispute.payer}>
                  {shortHash(dispute.payer)}
                </TableCell>
                <TableCell>{formatDateTime(dispute.openedAt)}</TableCell>
                <TableCell className="text-right">
                  <Badge variant={deadlineTone(dispute.resolveBy)}>
                    {formatDateTime(dispute.resolveBy)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ),
    )
    .exhaustive();
}

export default withQuery(DisputesQueue);
