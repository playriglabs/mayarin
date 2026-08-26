/**
 * Event logs — a React island over the real `/event-logs` endpoint.
 *
 * The merchant's unified timeline: clearing, settlement, and webhook events in
 * one derived read, newest first. A row links into its payment when the source
 * carried one — a webhook delivery in v1 does not, and that is shown as a plain
 * entry rather than a dead link.
 */

import {
  ArrowsClockwiseIcon,
  CoinsIcon,
  LightningIcon,
  PaperPlaneIcon,
} from "@phosphor-icons/react";
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
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import {
  Select,
  SelectContent,
  SelectItem,
  type SelectOption,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCursorPagination } from "@/hooks/cursor-pagination";
import { useEventLogs } from "@/hooks/event-logs";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { PAGE_SIZE } from "@/lib/pagination";
import { withQuery } from "@/lib/with-query";
import type { EventKind, EventSeverity, MerchantEventDto } from "@/types/event-logs";

const KIND_ICON: Readonly<Record<EventKind, typeof ArrowsClockwiseIcon>> = {
  clearing: ArrowsClockwiseIcon,
  settlement: CoinsIcon,
  webhook: PaperPlaneIcon,
};

const KIND_LABEL: Readonly<Record<EventKind, string>> = {
  clearing: "Clearing",
  settlement: "Settlement",
  webhook: "Webhook",
};

const STATUS_OPTIONS: readonly SelectOption[] = [
  { value: "all", label: "All severities" },
  { value: "info", label: "Info" },
  { value: "success", label: "Success" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
];

const SORT_OPTIONS: readonly SelectOption[] = [
  { value: "-created", label: "Newest first" },
  { value: "created", label: "Oldest first" },
];

function toneOf(severity: EventSeverity): "success" | "destructive" | "warning" | "default" {
  if (severity === "success") return "success";
  if (severity === "error") return "destructive";
  if (severity === "warning") return "warning";
  return "default";
}

function reasonOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Failed to load the event log";
}

function EventRow({ event }: { readonly event: MerchantEventDto }) {
  const Icon = KIND_ICON[event.kind];
  return (
    <li className="flex gap-3 border-b border-border py-3 last:border-b-0">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted">
        <Icon size={ICON_NAV} weight="bold" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm text-foreground">{event.summary}</p>
          <Badge variant={toneOf(event.severity)}>{KIND_LABEL[event.kind]}</Badge>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <time dateTime={isoAttr(event.occurredAt)}>{formatDateTime(event.occurredAt)}</time>
          {event.intentId === null ? (
            <span className="text-subtle-foreground">No linked payment</span>
          ) : (
            <a
              href={`/payments/${encodeURIComponent(event.intentId)}`}
              className="font-mono text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
            >
              {event.intentId}
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

function EventLogs() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<"created" | "-created">("-created");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const pagination = useCursorPagination();
  const deferredQuery = useDeferredValue(query.trim());
  const filter = {
    limit: PAGE_SIZE,
    ...(deferredQuery === "" ? {} : { q: deferredQuery }),
    ...(status === "all" ? {} : { status: status as EventSeverity }),
    sort,
    ...(from === "" ? {} : { from }),
    ...(to === "" ? {} : { to }),
  } as const;
  const events = useEventLogs(filter, pagination.cursor);
  const rows = events.data?.events ?? [];
  // See orders.tsx: `isPending`, so a background poll never greys the filters.
  const filtersBusy = events.isPending;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-56 flex-1">
          <Field>
            <FieldLabel htmlFor="event-search">Search</FieldLabel>
            <Input
              id="event-search"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                pagination.reset();
              }}
              placeholder="Search summaries"
            />
          </Field>
        </div>
        <div className="w-full sm:w-44">
          <Field>
            <FieldLabel htmlFor="event-status">Severity</FieldLabel>
            <Select
              items={STATUS_OPTIONS}
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                pagination.reset();
              }}
            >
              <SelectTrigger id="event-status" disabled={filtersBusy}>
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
            <FieldLabel htmlFor="event-sort">Sort</FieldLabel>
            <Select
              items={SORT_OPTIONS}
              value={sort}
              onValueChange={(value) => {
                setSort(value as typeof sort);
                pagination.reset();
              }}
            >
              <SelectTrigger id="event-sort" disabled={filtersBusy}>
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
          {rows.length} event{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {match(events)
        .with({ isPending: true }, () => <PageLoader label="Loading event logs" />)
        .with({ isError: true }, ({ error }) => (
          <QueryError
            message={reasonOf(error)}
            retry={() => void events.refetch()}
            retrying={events.isFetching}
          />
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <LightningIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No events yet.</EmptyTitle>
              <EmptyDescription>
                Payment, settlement, and webhook activity will appear here.
              </EmptyDescription>
              <EmptyAction>
                <a href="/links" className={buttonVariants()}>
                  Take your first payment
                </a>
              </EmptyAction>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              <ol>
                {rows.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ol>
              <CursorPagination
                label="Event pages"
                page={pagination.page}
                canPrevious={pagination.canPrevious}
                nextCursor={events.data?.nextCursor}
                busy={events.isFetching}
                onPrevious={pagination.previous}
                onNext={pagination.next}
              />
            </div>
          ),
        )}
    </section>
  );
}

export default withQuery(EventLogs);
