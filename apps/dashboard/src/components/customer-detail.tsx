/**
 * Customer detail — a React island over the real `/customers/:id` endpoint.
 *
 * The customer, their completed order volume, and every order taken for them.
 * Read-only here: editing happens on the directory page. A deleted customer
 * leaves their orders behind, so a customer whose id no longer resolves still
 * shows the orders that were taken for them — but this view is reached from the
 * directory, which only lists live customers, so a missing customer is a 404.
 */

import { ArrowLeftIcon } from "@phosphor-icons/react";
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
import { useCustomerDetail } from "@/hooks/customers";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { withQuery } from "@/lib/with-query";
import type { OrderDto } from "@/types/orders";

function toneOf(status: string): "success" | "destructive" | "warning" | "default" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED" || status === "EXPIRED") return "destructive";
  if (status === "CREATED") return "default";
  return "warning";
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load the customer";
}

function CustomerDetail({ id }: { id: string }) {
  const detail = useCustomerDetail(id);

  return (
    <div className="flex flex-col gap-8">
      <a
        href="/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon size={ICON_NAV} weight="bold" aria-hidden="true" />
        Back to customers
      </a>

      {match(detail)
        .with({ isPending: true }, () => (
          <>
            <StatGridSkeleton />
            <TableSkeleton rows={3} />
          </>
        ))
        .with({ isError: true }, ({ error }) => (
          <Alert variant="destructive">{reasonOf(error)}</Alert>
        ))
        .otherwise(() => {
          const data = detail.data;
          if (data === undefined) return null;
          const { customer, lifetimeValue, orders } = data;
          const completed = orders.filter((o) => o.status === "COMPLETED");
          return (
            <>
              <section className="flex flex-col gap-3">
                <SectionHeader title={customer.name} />
                <Card>
                  <dl className="flex flex-col gap-3 sm:flex-row sm:gap-8">
                    <div className="flex min-w-0 flex-col gap-1">
                      <dt className="text-xs text-subtle-foreground">Email</dt>
                      <dd className="text-sm text-foreground">{customer.email ?? "Not set"}</dd>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <dt className="text-xs text-subtle-foreground">Notes</dt>
                      <dd className="text-sm text-foreground">{customer.notes ?? "Not set"}</dd>
                    </div>
                    <div className="flex flex-col gap-1">
                      <dt className="text-xs text-subtle-foreground">Added</dt>
                      <dd className="text-sm text-foreground">
                        <time dateTime={isoAttr(customer.createdAt)}>
                          {formatDateTime(customer.createdAt)}
                        </time>
                      </dd>
                    </div>
                  </dl>
                </Card>
              </section>

              <StatGrid>
                <Stat
                  label="Lifetime value"
                  value={lifetimeValue === null ? "—" : lifetimeValue.display}
                  hint={
                    lifetimeValue === null
                      ? "No completed orders yet."
                      : `Across ${completed.length} completed order${completed.length === 1 ? "" : "s"}.`
                  }
                />
                <Stat
                  label="Orders"
                  value={String(orders.length)}
                  hint="Every order taken for this customer."
                />
              </StatGrid>

              <section className="flex flex-col gap-3">
                <SectionHeader title="Orders" />
                {orders.length === 0 ? (
                  <Empty>
                    <EmptyMedia>
                      <ArrowLeftIcon size={ICON_CARD} aria-hidden="true" />
                    </EmptyMedia>
                    <EmptyTitle>No orders for this customer yet.</EmptyTitle>
                  </Empty>
                ) : (
                  <Table>
                    <TableCaption>Orders taken for {customer.name}</TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Items</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order: OrderDto) => (
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
                            {order.lines
                              .map((line) =>
                                line.quantity === 1 ? line.name : `${line.name} × ${line.quantity}`,
                              )
                              .join(", ")}
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
                )}
              </section>
            </>
          );
        })}
    </div>
  );
}

export default withQuery(CustomerDetail);
