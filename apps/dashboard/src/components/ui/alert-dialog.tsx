import { AlertDialog as AlertDialogPrimitive } from "@base-ui-components/react/alert-dialog";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { dialogVariants, overlayVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Alert dialog, on Base UI.
 *
 * Distinct from `Dialog`, and the difference is not cosmetic: an alert dialog
 * does not dismiss on an outside press, so a destructive choice has to be made
 * rather than clicked away by accident. Correct for "are you sure", wrong for
 * an editor.
 *
 * Exit animation works the same way as `Dialog`: `AnimatePresence` gates the
 * portal so the `exit` variant runs, then `onExitComplete` calls Base UI's
 * `actionsRef.unmount()` to release its teardown.
 */

interface AlertDialogContextValue {
  readonly open: boolean;
  readonly actionsRef: React.RefObject<AlertDialogPrimitive.Root.Actions | null>;
}

const AlertDialogContext = React.createContext<AlertDialogContextValue>({
  open: false,
  actionsRef: { current: null },
});

function AlertDialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<React.ComponentProps<typeof AlertDialogPrimitive.Root>, "actionsRef">) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const open = openProp ?? uncontrolledOpen;
  const actionsRef = React.useRef<AlertDialogPrimitive.Root.Actions | null>(null);

  const handleOpenChange: NonNullable<
    React.ComponentProps<typeof AlertDialogPrimitive.Root>["onOpenChange"]
  > = (next, details) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next, details);
  };

  const context = React.useMemo(() => ({ open, actionsRef }), [open]);

  return (
    <AlertDialogContext.Provider value={context}>
      <AlertDialogPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        actionsRef={actionsRef as React.RefObject<AlertDialogPrimitive.Root.Actions>}
        {...props}
      />
    </AlertDialogContext.Provider>
  );
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Backdrop>) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn("fixed inset-0 z-40 bg-foreground/20", className)}
      render={
        <motion.div variants={overlayVariants} initial="initial" animate="animate" exit="exit" />
      }
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Popup>) {
  const { open, actionsRef } = React.useContext(AlertDialogContext);
  return (
    <AnimatePresence onExitComplete={() => actionsRef.current?.unmount()}>
      {open && (
        <AlertDialogPrimitive.Portal keepMounted>
          <AlertDialogOverlay />
          <AlertDialogPrimitive.Popup
            data-slot="alert-dialog-content"
            // Centring offsets live in `dialogVariants`, not in `-translate-*`
            // classes, because motion owns `transform` on this element.
            className={cn(
              "fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-4 border border-border bg-popover p-4 text-popover-foreground",
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
          />
        </AlertDialogPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex justify-end gap-2", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-[20px] font-medium leading-tight text-foreground", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm mt-2 leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

/** Closes the dialog and does nothing else. */
function AlertDialogCancel({
  children = "Cancel",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Close>) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      render={<Button variant="secondary" />}
      {...props}
    >
      {children}
    </AlertDialogPrimitive.Close>
  );
}

/**
 * The committing button. It is NOT a `Close`: the caller decides whether the
 * action succeeded before the dialog goes away.
 */
function AlertDialogAction({
  className,
  variant = "destructive",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button data-slot="alert-dialog-action" variant={variant} className={className} {...props} />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogTitle,
  AlertDialogTrigger,
};
