/**
 * The bell in the header: the unread count, and on click the six newest
 * notifications with a link to the full page.
 *
 * A popover under the bell on a desktop; on a phone, where that is cramped, a panel
 * that slides in from the left as the navigation menu does.
 *
 * A failed or pending read shows the plain bell — a missing badge is better
 * than an error in the header of every page.
 */

import { Popover } from "@base-ui-components/react/popover";
import { BellIcon, BellSlashIcon, XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import { NotificationRow } from "@/components/notifications";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDrawer,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useMarkSeen, useNotifications } from "@/hooks/notifications";
import { popupVariants } from "@/lib/motion";
import { withQuery } from "@/lib/with-query";

const PREVIEW_SIZE = 6;

/** Tailwind's `md` is 768px: below it the dashboard uses the phone layout. */
const PHONE_QUERY = "(max-width: 767px)";

function useIsPhone(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(PHONE_QUERY);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

const TRIGGER_CLASS =
  "relative flex size-10 cursor-pointer items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors duration-200 hover:bg-muted hover:text-foreground";

function Bell({ unread }: { readonly unread: number }) {
  return (
    <>
      <BellIcon size={20} weight="regular" aria-hidden="true" />
      {unread > 0 && (
        <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[11px] font-semibold leading-none text-white tabular-nums">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </>
  );
}

function NotificationList({
  latest,
  pending,
  className,
}: {
  readonly latest: readonly Parameters<typeof NotificationRow>[0]["notification"][];
  readonly pending: boolean;
  readonly className: string;
}) {
  if (latest.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <BellSlashIcon size={20} aria-hidden="true" />
        </span>
        <p className="text-sm text-muted-foreground">
          {pending ? "Loading…" : "No notifications yet."}
        </p>
      </div>
    );
  }
  return (
    <ul className={className}>
      {latest.map((notification) => (
        <NotificationRow key={notification.id} notification={notification} />
      ))}
    </ul>
  );
}

function SeeAll() {
  return (
    <a
      href="/notifications"
      className="border-t border-border px-4 py-3 text-center text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted"
    >
      See all
    </a>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const phone = useIsPhone();
  const feed = useNotifications({ limit: PREVIEW_SIZE });
  const unread = feed.data?.unread ?? 0;
  const latest = feed.data?.notifications ?? [];
  // Opening the bell is reading it.
  useMarkSeen(open, unread);
  const label = unread === 0 ? "Open notifications" : `Open notifications, ${unread} unread`;

  if (phone) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          data-tour="notifications"
          aria-label={label}
          title="Notifications"
          className={TRIGGER_CLASS}
        >
          <Bell unread={unread} />
        </DialogTrigger>
        <DialogDrawer>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <DialogTitle className="text-sm font-semibold">Notifications</DialogTitle>
            <DialogClose
              render={
                <Button variant="ghost" size="icon" aria-label="Close">
                  <XIcon size={14} weight="bold" aria-hidden="true" />
                </Button>
              }
            />
          </div>
          <NotificationList
            latest={latest}
            pending={feed.isPending}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3"
          />
          <div className="mt-auto flex flex-col">
            <SeeAll />
          </div>
        </DialogDrawer>
      </Dialog>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        data-tour="notifications"
        aria-label={label}
        title="Notifications"
        className={TRIGGER_CLASS}
      >
        <Bell unread={unread} />
      </Popover.Trigger>
      <AnimatePresence>
        {open && (
          <Popover.Portal>
            <Popover.Positioner sideOffset={8} align="end" className="z-80">
              <Popover.Popup
                className="flex w-96 max-w-[calc(100vw-2rem)] origin-top-right flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-sm"
                render={
                  <motion.div
                    variants={popupVariants}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                  />
                }
              >
                <div className="border-b border-border px-4 py-3">
                  <Popover.Title className="text-sm font-semibold text-foreground">
                    Notifications
                  </Popover.Title>
                </div>
                <NotificationList
                  latest={latest}
                  pending={feed.isPending}
                  className="flex max-h-[60vh] flex-col overflow-y-auto px-3"
                />
                <SeeAll />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
}

export default withQuery(NotificationBell);
