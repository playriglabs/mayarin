/**
 * Payment explorer — a React island over the real `/payments` endpoint.
 *
 * Filtering is client-side over the page the API already returned. That is
 * honest for a first slice: the list endpoint takes a `limit` and nothing else,
 * so a server-side filter would be a new endpoint, and pretending otherwise
 * would hide the fact that the filter only sees what is loaded.
 *
 * The result count is announced in a live region, so a screen-reader user
 * hears the list change when they type — the visual row count is not enough.
 */

import { MagnifyingGlassIcon, ReceiptIcon } from "@phosphor-icons/react";
import { useDeferredValue, useState } from "react";
import { match } from "ts-pattern";
import { AssetLabel } from "@/components/asset-logo";
import { ChainLabel } from "@/components/chain-logo";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
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
import { usePaymentPage } from "@/hooks/payments";
import { ApiError } from "@/lib/api/client";
import { intentStatusLabel, toneOf } from "@/lib/clearing";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { PAGE_SIZE } from "@/lib/pagination";
import { withQuery } from "@/lib/with-query";
import type { PaymentIntentDto, PaymentIntentStatus } from "@/types/payment";

const STATUSES: readonly PaymentIntentStatus[] = [
  "CREATED",
  "CONFIRMED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
];

/** `"all"` is a filter value, not a payment status, so it lives only here. */
const STATUS_OPTIONS: readonly SelectOption[] = [
  { value: "all", label: "All statuses" },
  ...STATUSES.map((s) => ({ value: s, label: intentStatusLabel(s) })),
];

const SORT_OPTIONS: readonly SelectOption[] = [
  { value: "-created", label: "Newest first" },
  { value: "created", label: "Oldest first" },
  { value: "-amount", label: "Highest amount" },
];

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load payments";
}

function PaymentsExplorer() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<"created" | "-created" | "-amount">("-created");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const pagination = useCursorPagination();
  const filter = {
    limit: PAGE_SIZE,
    ...(deferredQuery === "" ? {} : { q: deferredQuery }),
    ...(status === "all" ? {} : { status: status as PaymentIntentDto["status"] }),
    sort,
    ...(from === "" ? {} : { from }),
    ...(to === "" ? {} : { to }),
  } as const;
  const payments = usePaymentPage(filter, pagination.cursor);

  const all = payments.data?.payments ?? [];
  // See orders.tsx: `isPending`, so a background poll never greys the filters.
  const filtersBusy = payments.isPending;
  const rows = all;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-56 flex-1">
          <Field>
            <FieldLabel htmlFor="payment-search">Search</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <MagnifyingGlassIcon size={ICON_NAV} />
              </InputGroupAddon>
              <InputGroupInput
                id="payment-search"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  pagination.reset();
                }}
                placeholder="Search with payment id e.g pi_.."
                aria-describedby="payment-search-hint"
              />
            </InputGroup>
            <FieldDescription id="payment-search-hint">
              Payment id or merchant name.
            </FieldDescription>
          </Field>
        </div>
        <div className="w-full sm:w-44">
          <Field>
            <FieldLabel htmlFor="payment-status">Status</FieldLabel>
            <Select
              items={STATUS_OPTIONS}
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                pagination.reset();
              }}
            >
              <SelectTrigger id="payment-status" disabled={filtersBusy}>
                <SelectValue placeholder="All statuses" />
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
            disabled={filtersBusy}
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
            <FieldLabel htmlFor="payment-sort">Sort</FieldLabel>
            <Select
              items={SORT_OPTIONS}
              value={sort}
              onValueChange={(value) => {
                setSort(value as typeof sort);
                pagination.reset();
              }}
            >
              <SelectTrigger id="payment-sort" disabled={filtersBusy}>
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

      <p aria-live="polite" className="font-mono text-xs text-subtle-foreground">
        {payments.status === "success" &&
          `${rows.length} payment${rows.length === 1 ? "" : "s"} loaded`}
      </p>

      {match(payments)
        .with({ status: "pending" }, () => (
          <div role="status" aria-live="polite">
            <span className="sr-only">Loading payments</span>
            <TableSkeleton rows={PAGE_SIZE} />
          </div>
        ))
        .with({ status: "error" }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void payments.refetch()}
            retrying={payments.isFetching}
          />
        ))
        .with({ status: "success" }, () =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <ReceiptIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                {all.length === 0 ? "No payments yet." : "No payment matches this filter."}
              </EmptyTitle>
              {all.length === 0 ? (
                <>
                  <EmptyDescription>
                    Start with a reusable checkout link or counter QR.
                  </EmptyDescription>
                  <EmptyAction>
                    <a href="/links" className={buttonVariants()}>
                      Create a payment link
                    </a>
                  </EmptyAction>
                </>
              ) : (
                <EmptyDescription>Try a broader search or choose another status.</EmptyDescription>
              )}
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              <Table>
                <TableCaption>Payments for this merchant</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Customer amount</TableHead>
                    <TableHead>Network</TableHead>
                    <TableHead>Settles in</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.id} className="hover:bg-muted">
                      <TableCell>
                        <a
                          href={`/payments/${encodeURIComponent(p.id)}`}
                          className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                        >
                          <ReceiptIcon size={12} aria-hidden="true" className="shrink-0" />
                          {p.id}
                        </a>
                      </TableCell>
                      <TableCell>
                        <Badge variant={toneOf(p.status)}>{intentStatusLabel(p.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{p.amount.display}</TableCell>
                      <TableCell>
                        {p.payment === null ? (
                          <span className="text-subtle-foreground text-xs">—</span>
                        ) : (
                          <ChainLabel chain={p.payment.chain} size={18} />
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <AssetLabel symbol={p.settlementAsset} size={18} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <time dateTime={isoAttr(p.createdAt)}>{formatDateTime(p.createdAt)}</time>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <CursorPagination
                label="Payment pages"
                page={pagination.page}
                canPrevious={pagination.canPrevious}
                nextCursor={payments.data?.nextCursor}
                busy={payments.isFetching}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </div>
          ),
        )
        .exhaustive()}
    </section>
  );
}

export default withQuery(PaymentsExplorer);
