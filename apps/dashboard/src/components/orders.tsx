/**
 * Orders — a React island over the real `/orders` endpoint.
 *
 * The commerce view of a merchant's payments: line items and the customer,
 * rather than the clearing rail. An order is a payment intent that carries a
 * cart snapshot or a merchant reference; a plain transfer is not one, and is
 * already shown on the payments page.
 *
 * Rows link to the payment they are — an order is a different read of the same
 * record, so its detail is the payment detail, not a second page.
 */

import { ShoppingCartIcon } from "@phosphor-icons/react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { TableSkeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useOrders } from "@/hooks/orders";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";
import type { OrderDto } from "@/types/orders";

/** Maps the payment's status onto a badge tone a merchant reads at a glance. */
function toneOf(status: string): "success" | "destructive" | "warning" | "default" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED" || status === "EXPIRED") return "destructive";
  if (status === "CREATED") return "default";
  return "warning";
}

/** One line per unit, or a compact `name × n` for a multi-quantity line. */
function lineSummary(order: OrderDto): string {
  return order.lines
    .map((line) => (line.quantity === 1 ? line.name : `${line.name} × ${line.quantity}`))
    .join(", ");
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load orders";
}

function Orders() {
  const orders = useOrders(100);
  const rows = orders.data?.orders ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} order{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {match(orders)
        .with({ isPending: true }, () => <TableSkeleton rows={4} />)
        .with({ isError: true }, ({ error }) => (
          <Alert variant="destructive">{reasonOf(error)}</Alert>
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <ShoppingCartIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No orders yet.</EmptyTitle>
            </Empty>
          ) : (
            <Table>
              <TableCaption>Orders taken through your payment links</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((order) => (
                  <TableRow key={order.id} className="hover:bg-muted">
                    <TableCell>
                      <a
                        href={`/payments/${encodeURIComponent(order.paymentIntentId)}`}
                        className="font-mono text-xs text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                      >
                        {order.merchantReference ?? order.paymentIntentId}
                      </a>
                    </TableCell>
                    <TableCell className="max-w-[20rem] truncate text-sm text-muted-foreground">
                      {lineSummary(order)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {order.customer === null ? (
                        <span className="text-xs text-subtle-foreground">Walk-in</span>
                      ) : (
                        <a
                          href={`/customers/${encodeURIComponent(order.customer.id)}`}
                          className="text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                        >
                          {order.customer.name}
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={toneOf(order.status)}>{order.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{order.total.display}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <time dateTime={isoAttr(order.createdAt)}>
                        {formatDateTime(order.createdAt)}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        )}
    </section>
  );
}

export default withQuery(Orders);
