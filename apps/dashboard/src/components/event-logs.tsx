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
import { match } from "ts-pattern";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PanelSkeleton } from "@/components/ui/skeleton";
import { useEventLogs } from "@/hooks/event-logs";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
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
  const events = useEventLogs(100);
  const rows = events.data?.events ?? [];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs text-subtle-foreground">
          {rows.length} event{rows.length === 1 ? "" : "s"}
        </p>
      </div>

      {match(events)
        .with({ isPending: true }, () => <PanelSkeleton lines={6} />)
        .with({ isError: true }, ({ error }) => (
          <Alert variant="destructive">{reasonOf(error)}</Alert>
        ))
        .otherwise(() =>
          rows.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <LightningIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No events yet.</EmptyTitle>
            </Empty>
          ) : (
            <ol>
              {rows.map((event) => (
                <EventRow
                  key={`${event.kind}-${event.occurredAt}-${event.summary}`}
                  event={event}
                />
              ))}
            </ol>
          ),
        )}
    </section>
  );
}

export default withQuery(EventLogs);
