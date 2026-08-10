import { Dialog as DialogPrimitive } from "@base-ui-components/react/dialog";
import { XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { dialogVariants, overlayVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Dialog, on Base UI.
 *
 * Base UI supplies the modal semantics that are tedious to get right by hand:
 * focus moves into the popup on open and returns to the trigger on close,
 * Escape dismisses, and the rest of the page goes inert to a screen reader.
 *
 * `DialogContent` bundles portal + backdrop + popup, matching shadcn's shape,
 * so a caller writes one element rather than three nested ones.
 *
 * ## How the exit animation works
 *
 * Base UI unmounts as soon as the dialog closes, which would make it blink out
 * with no fade. `actionsRef` is its hook for when an external library owns the
 * animation: `AnimatePresence` gates the portal so the `exit` variant runs, and
 * `onExitComplete` then calls `unmount()` to release Base UI's own teardown.
 * The overlay and the popup animate together inside the same gate, so they
 * never fade at different times.
 */

interface DialogContextValue {
  readonly open: boolean;
  readonly actionsRef: React.RefObject<DialogPrimitive.Root.Actions | null>;
}

const DialogContext = React.createContext<DialogContextValue>({
  open: false,
  actionsRef: { current: null },
});

function Dialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Root>, "actionsRef">) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const open = openProp ?? uncontrolledOpen;
  const actionsRef = React.useRef<DialogPrimitive.Root.Actions | null>(null);

  const handleOpenChange: NonNullable<
    React.ComponentProps<typeof DialogPrimitive.Root>["onOpenChange"]
  > = (next, details) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next, details);
  };

  const context = React.useMemo(() => ({ open, actionsRef }), [open]);

  return (
    <DialogContext.Provider value={context}>
      <DialogPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        actionsRef={actionsRef as React.RefObject<DialogPrimitive.Root.Actions>}
        {...props}
      />
    </DialogContext.Provider>
  );
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn("fixed inset-0 z-40 bg-foreground/20", className)}
      render={
        <motion.div variants={overlayVariants} initial="initial" animate="animate" exit="exit" />
      }
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup> & { showCloseButton?: boolean }) {
  const { open, actionsRef } = React.useContext(DialogContext);
  return (
    <AnimatePresence onExitComplete={() => actionsRef.current?.unmount()}>
      {open && (
        <DialogPrimitive.Portal keepMounted>
          <DialogOverlay />
          <DialogPrimitive.Popup
            data-slot="dialog-content"
            // No `-translate-*` classes here: motion owns `transform`, and the
            // centring offsets live in `dialogVariants` so a scale animation
            // cannot clobber them.
            className={cn(
              "fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-md flex-col gap-5 border border-border bg-popover p-4 text-popover-foreground",
              className,
            )}
            render={
              <motion.div
                variants={dialogVariants}
                initial="initial"
                animate="animate"
                exit="exit"
              />
            }
            {...props}
          >
            {children}
            {showCloseButton && (
              <DialogPrimitive.Close
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Close"
                    className="absolute top-3 right-3"
                  >
                    <XIcon size={14} weight="bold" aria-hidden="true" />
                  </Button>
                }
              />
            )}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-1 pr-8", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-footer" className={cn("flex justify-end gap-2", className)} {...props} />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-xs text-subtle-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
  DialogTrigger,
};
