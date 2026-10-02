/**
 * A merchant's own escrow disputes (#313).
 *
 * The list exists so a dispute is noticed: without it, a merchant learns of
 * one only by opening that payment. Each row opens the dispute itself.
 */

import { chainLabel } from "@mayarin/chain";
import { ScalesIcon } from "@phosphor-icons/react";
import { match } from "ts-pattern";
import { deadlineTone } from "@/components/disputes-queue";
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
import { useMerchantDisputes } from "@/hooks/disputes";
import { ApiError } from "@/lib/api/client";
import { formatDateTime } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";
import type { DisputeDto } from "@/types/payment";

const STATUS: Readonly<
  Record<DisputeDto["status"], readonly [string, "destructive" | "success" | "default"]>
> = {
  open: ["Needs your answer", "destructive"],
  released: ["Released to you", "success"],
  split: ["Split", "success"],
  refunded: ["Refunded", "default"],
};

function MerchantDisputes() {
  const disputes = useMerchantDisputes();

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
          <EmptyTitle>No disputes.</EmptyTitle>
          <EmptyDescription>
            When a buyer disputes an escrowed payment, it appears here for you to answer.
          </EmptyDescription>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dispute</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Opened</TableHead>
              <TableHead className="text-right">Refunds the buyer if undecided by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.disputes.map((dispute) => {
              const [label, tone] = STATUS[dispute.status];
              return (
                <TableRow key={dispute.id}>
                  <TableCell>
                    <a
                      href={`/disputes/${dispute.id}`}
                      className="font-medium underline decoration-input underline-offset-2 hover:decoration-foreground"
                    >
                      #{dispute.reference}
                    </a>
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground text-xs">
                    {dispute.paymentIntentId}
                  </TableCell>
                  <TableCell>{chainLabel(dispute.chain)}</TableCell>
                  <TableCell>
                    <Badge variant={tone}>{label}</Badge>
                  </TableCell>
                  <TableCell>{formatDateTime(dispute.openedAt)}</TableCell>
                  <TableCell className="text-right">
                    {dispute.status === "open" ? (
                      <Badge variant={deadlineTone(dispute.resolveBy)}>
                        {formatDateTime(dispute.resolveBy)}
                      </Badge>
                    ) : (
                      <span className="text-subtle-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ),
    )
    .exhaustive();
}

export default withQuery(MerchantDisputes);
