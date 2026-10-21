/**
 * Notifications — the page behind the bell.
 *
 * Ten a page, worded by the API, newest first. The category filter is applied
 * by the API so every page is full. Opening the page moves this account's
 * seen mark to now, which also clears the badge on the bell.
 */

import {
  BellIcon,
  CoinsIcon,
  FileTextIcon,
  GearSixIcon,
  RepeatIcon,
  ScalesIcon,
  ShieldWarningIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { match } from "ts-pattern";
import { Button } from "@/components/ui/button";
import { CursorPagination } from "@/components/ui/cursor-pagination";
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PageLoader } from "@/components/ui/page-loader";
import { QueryError } from "@/components/ui/query-error";
import { useCursorPagination } from "@/hooks/cursor-pagination";
import { useMarkSeen, useNotifications } from "@/hooks/notifications";
import { ApiError } from "@/lib/api/client";
import { formatDateTime, isoAttr } from "@/lib/date";
import { ICON_CARD, ICON_NAV } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { withQuery } from "@/lib/with-query";
import type {
  NotificationCategory,
  NotificationDto,
  NotificationTone,
} from "@/types/notifications";

const CATEGORY_ICON: Readonly<Record<NotificationCategory, typeof BellIcon>> = {
  payment: CoinsIcon,
  dispute: ScalesIcon,
  security: ShieldWarningIcon,
  operations: GearSixIcon,
};

/** Invoice and subscription lines share the operations category but read as their nav pages do. */
function iconOf(notification: NotificationDto) {
  if (notification.type.startsWith("invoice.")) return FileTextIcon;
  if (notification.type.startsWith("subscription.")) return RepeatIcon;
  return CATEGORY_ICON[notification.category];
}

const PAGE_SIZE = 10;

const FILTERS: readonly { readonly value: NotificationCategory | "all"; readonly label: string }[] =
  [
    { value: "all", label: "All" },
    { value: "payment", label: "Payments" },
    { value: "dispute", label: "Disputes" },
    { value: "security", label: "Security" },
    { value: "operations", label: "Operations" },
  ];

const TONE_CLASS: Readonly<Record<NotificationTone, string>> = {
  info: "bg-muted text-muted-foreground",
  success: "bg-success-muted text-success",
  warning: "bg-warning-muted text-warning",
  error: "bg-destructive-muted text-destructive",
};

/** One line of the feed; the bell's popup shows the same row. */
export function NotificationRow({ notification }: { readonly notification: NotificationDto }) {
  const Icon = iconOf(notification);
  const content = (
    <>
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded",
          TONE_CLASS[notification.tone],
        )}
      >
        <Icon size={ICON_NAV} weight="bold" aria-hidden="true" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-start justify-between gap-3">
          <p
            className={cn(
              "wrap-anywhere text-sm text-foreground",
              notification.unread ? "font-semibold" : "font-medium",
            )}
          >
            {notification.title}
          </p>
          {notification.unread && (
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand">
              <span className="sr-only">Unread</span>
            </span>
          )}
        </div>
        {notification.body !== null && (
          <p className="wrap-anywhere text-sm text-muted-foreground mt-px">{notification.body}</p>
        )}
        <time
          dateTime={isoAttr(notification.occurredAt)}
          className="text-xs mt-1 text-subtle-foreground"
        >
          {formatDateTime(notification.occurredAt)}
        </time>
      </div>
    </>
  );

  return (
    <li className="border-b border-border last:border-b-0">
      {notification.href === null ? (
        <div className="flex gap-3 px-1 py-3">{content}</div>
      ) : (
        <a
          href={notification.href}
          className="flex gap-3 rounded px-1 py-3 transition-colors duration-150 hover:bg-muted"
        >
          {content}
        </a>
      )}
    </li>
  );
}

function Notifications() {
  const [filter, setFilter] = useState<NotificationCategory | "all">("all");
  const pagination = useCursorPagination();
  const feed = useNotifications(
    { limit: PAGE_SIZE, ...(filter === "all" ? {} : { category: filter }) },
    pagination.cursor,
  );
  // Opening the page is reading it.
  useMarkSeen(true, feed.data?.unread ?? 0);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex flex-wrap gap-1">
          <legend className="sr-only">Filter notifications</legend>
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={filter === option.value ? "secondary" : "ghost"}
              aria-pressed={filter === option.value}
              onClick={() => {
                setFilter(option.value);
                pagination.reset();
              }}
            >
              {option.label}
            </Button>
          ))}
        </fieldset>
      </div>

      {match(feed)
        .with({ status: "pending" }, () => <PageLoader label="Loading notifications" />)
        .with({ status: "error" }, ({ error }) => (
          <QueryError
            message={error instanceof ApiError ? error.message : "Failed to load notifications"}
            retry={() => void feed.refetch()}
            retrying={feed.isFetching}
          />
        ))
        .with({ status: "success" }, ({ data }) =>
          data.notifications.length === 0 ? (
            <Empty>
              <EmptyMedia>
                <BellIcon size={ICON_CARD} aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>Nothing here yet.</EmptyTitle>
              <EmptyDescription>
                Payments, disputes and changes to your account show up here as they happen.
              </EmptyDescription>
            </Empty>
          ) : (
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col">
                {data.notifications.map((notification) => (
                  <NotificationRow key={notification.id} notification={notification} />
                ))}
              </ul>
              <CursorPagination
                label="Notification pages"
                page={pagination.page}
                canPrevious={pagination.canPrevious}
                nextCursor={data.nextCursor}
                busy={feed.isFetching}
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

export default withQuery(Notifications);
