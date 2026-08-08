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
import { useMemo, useState } from "react";
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
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

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load payments";
}

function matches(payment: PaymentIntentDto, query: string, status: string): boolean {
  if (status !== "all" && payment.status !== status) return false;
  if (query === "") return true;
  const needle = query.toLowerCase();
  return (
    payment.id.toLowerCase().includes(needle) ||
    payment.merchant.name.toLowerCase().includes(needle)
  );
}

function PaymentsExplorer() {
  const payments = usePayments(100);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>("all");

  const all = payments.data?.payments ?? [];
  const rows = useMemo(
    () => all.filter((p) => matches(p, query.trim(), status)),
    [all, query, status],
  );

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
                onChange={(e) => setQuery(e.target.value)}
                placeholder="pi_…"
                aria-describedby="payment-search-hint"
              />
            </InputGroup>
            <FieldDescription id="payment-search-hint">
              Payment id or merchant name.
            </FieldDescription>
          </Field>
        </div>
        <div className="w-44">
          <Field>
            <FieldLabel htmlFor="payment-status">Status</FieldLabel>
            <Select items={STATUS_OPTIONS} value={status} onValueChange={setStatus}>
              <SelectTrigger id="payment-status">
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
      </div>

      <p aria-live="polite" className="font-mono text-xs text-subtle-foreground">
        {payments.status === "success" &&
          `${rows.length} of ${all.length} payment${all.length === 1 ? "" : "s"}`}
      </p>

      {match(payments)
        .with({ status: "pending" }, () => (
          <div role="status" aria-live="polite" className="flex flex-col gap-2">
            <span className="sr-only">Loading payments</span>
            <Skeleton aria-hidden="true" />
            <Skeleton aria-hidden="true" />
            <Skeleton aria-hidden="true" />
          </div>
        ))
        .with({ status: "error" }, ({ error }) => (
          <Alert variant="destructive">{reasonOf(error)}</Alert>
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
            </Empty>
          ) : (
            <Table>
              <TableCaption>Payments for this merchant</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
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
                        className="font-mono text-xs text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
                      >
                        {p.id}
                      </a>
                    </TableCell>
                    <TableCell>
                      <Badge variant={toneOf(p.status)}>{intentStatusLabel(p.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{p.amount.formatted}</TableCell>
                    <TableCell className="text-muted-foreground">{p.settlementAsset}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <time dateTime={isoAttr(p.createdAt)}>{formatDateTime(p.createdAt)}</time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ),
        )
        .exhaustive()}
    </section>
  );
}

export default withQuery(PaymentsExplorer);
