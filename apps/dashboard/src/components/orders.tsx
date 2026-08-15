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
import { useDeferredValue, useState } from "react";
import { match } from "ts-pattern";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { CursorPagination } from "@/components/ui/cursor-pagination";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import {
  Empty,
  EmptyAction,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { QueryError } from "@/components/ui/query-error";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useCursorPagination } from "@/hooks/cursor-pagination";
import { useOrderPage } from "@/hooks/orders";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD } from "@/lib/icons";
import { PAGE_SIZE } from "@/lib/pagination";
import { withQuery } from "@/lib/with-query";
import type { OrderDto } from "@/types/orders";

const STATUS_OPTIONS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "CREATED", label: "Created" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "PROCESSING", label: "Processing" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "EXPIRED", label: "Expired" },
];

const SORT_OPTIONS: readonly SelectOption[] = [
  { value: "-created", label: "Newest first" },
  { value: "created", label: "Oldest first" },
  { value: "-amount", label: "Highest amount" },
];

/** Maps the payment's status onto a badge tone a merchant reads at a glance. */
function toneOf(status: string): "success" | "destructive" | "warning" | "default" {
  if (status === "COMPLETED") return "success";
  if (status === "FAILED" || status === "EXPIRED") return "destructive";
  if (status === "CREATED") return "default";
  return "warning";
}

/** `name` or `name × n` for a multi-quantity line. */
function lineLabel(line: OrderDto["lines"][number]): string {
  return line.quantity === 1 ? line.name : `${line.name} × ${line.quantity}`;
}

/** How many lines a row shows before the rest collapse into a `+n` badge. */
const LINES_SHOWN = 3;

/**
 * The items cell. A four-product order does not get four names crammed into
 * one truncated cell — it gets the first three and a `+n` badge, with the full
 * list on hover and on the payment detail the row links to.
 */
function LineItems({ order }: { readonly order: OrderDto }) {
  const shown = order.lines.slice(0, LINES_SHOWN);
  const hidden = order.lines.length - shown.length;
  const full = order.lines.map(lineLabel).join(", ");

  return (
    <span className="flex items-center gap-1.5" title={full}>
      <span className="truncate">{shown.map(lineLabel).join(", ")}</span>
      {hidden > 0 && (
        <Badge variant="default" aria-label={`${hidden} more item${hidden === 1 ? "" : "s"}`}>
          +{hidden}
        </Badge>
      )}
    </span>
  );
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load orders";
}

function Orders() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<"created" | "-created" | "-amount">("-created");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const pagination = useCursorPagination();
  const deferredQuery = useDeferredValue(query.trim());
  const orders = useOrderPage(
    {
      limit: PAGE_SIZE,
      ...(deferredQuery === "" ? {} : { q: deferredQuery }),
      ...(status === "all" ? {} : { status }),
      sort,
      ...(from === "" ? {} : { from }),
      ...(to === "" ? {} : { to }),
    },
    pagination.cursor,
  );
  const rows = orders.data?.orders ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-56 flex-1">
          <Field>
            <FieldLabel htmlFor="order-search">Search</FieldLabel>
            <Input
              id="order-search"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                pagination.reset();
              }}
              placeholder="Reference or payment id"
            />
          </Field>
        </div>
        <div className="w-full sm:w-44">
          <Field>
            <FieldLabel htmlFor="order-status">Status</FieldLabel>
            <Select
              items={STATUS_OPTIONS}
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                pagination.reset();
              }}
            >
              <SelectTrigger id="order-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto">
          <DateRangeFilter
            from={from}
            to={to}
            onFromChange={(value) => {
              setFrom(value);
              pagination.reset();
            }}
            onToChange={(value) => {
              setTo(value);
              pagination.reset();
            }}
          />
        </div>
        <div className="w-full sm:w-44">
          <Field>
            <FieldLabel htmlFor="order-sort">Sort</FieldLabel>
            <Select
              items={SORT_OPTIONS}
              value={sort}
              onValueChange={(value) => {
                setSort(value as typeof sort);
                pagination.reset();
              }}
            >
              <SelectTrigger id="order-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} order{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {match(orders)
        .with({ isPending: true }, () => <TableSkeleton rows={PAGE_SIZE} />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void orders.refetch()}
            retrying={orders.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <ShoppingCartIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No orders yet.</EmptyTitle>
              <EmptyDescription>
                Orders appear when a customer pays through a payment link.
              </EmptyDescription>
              <EmptyAction>
                <a href="/links" className={buttonVariants()}>
                  Create a payment link
                </a>
              </EmptyAction>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
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
                      <TableCell className="max-w-[20rem] text-sm text-muted-foreground">
                        <LineItems order={order} />
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
              <CursorPagination
                label="Order pages"
                page={pagination.page}
                canPrevious={pagination.canPrevious}
                nextCursor={orders.data?.nextCursor}
                busy={orders.isFetching}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </div>
          ),
        )}
    </section>
  );
}

export default withQuery(Orders);
