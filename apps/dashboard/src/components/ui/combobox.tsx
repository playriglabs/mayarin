import { Combobox as ComboboxPrimitive } from "@base-ui-components/react/combobox";
import { CaretUpDownIcon, CheckIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { popupVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Combobox, on Base UI — a Select whose list is long enough to need typing.
 *
 * Use it when the option count passes the point where scanning beats reading;
 * below that a `Select` is the simpler control and stays the default. Base UI
 * filters `items` against the input on its own, so nothing here re-implements
 * search.
 *
 * The exit animation works exactly as `select.tsx` describes: the root is
 * controlled so `open` is readable, `AnimatePresence` gates the portal, and
 * Base UI defers its teardown to `actionsRef.current.unmount()`.
 */

export interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  /** Rendered, but not selectable. A market that is coming, not one that is absent. */
  readonly disabled?: boolean;
}

interface ComboboxContextValue {
  readonly open: boolean;
  readonly actionsRef: React.RefObject<ComboboxPrimitive.Root.Actions | null>;
}

const ComboboxContext = React.createContext<ComboboxContextValue>({
  open: false,
  actionsRef: { current: null },
});

function Combobox({
  items,
  value,
  open: openProp,
  defaultOpen,
  onOpenChange,
  onValueChange,
  ...props
}: Omit<
  React.ComponentProps<typeof ComboboxPrimitive.Root>,
  "items" | "value" | "onValueChange" | "actionsRef"
> & {
  items: readonly ComboboxOption[];
  /** The selected option's `value`. Empty string means nothing is selected. */
  value?: string;
  /** Narrowed from Base UI's `any` — every option value here is a string. */
  onValueChange?: (value: string) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const open = openProp ?? uncontrolledOpen;
  const actionsRef = React.useRef<ComboboxPrimitive.Root.Actions | null>(null);

  const handleOpenChange: NonNullable<
    React.ComponentProps<typeof ComboboxPrimitive.Root>["onOpenChange"]
  > = (next, details) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next, details);
  };

  const context = React.useMemo(() => ({ open, actionsRef }), [open]);

  // Base UI selects and filters over the option OBJECTS, because that is what
  // it needs to render a label and match a query. Callers here deal in the
  // option's `value` string, so the translation happens once, at this boundary,
  // rather than every call site holding an object it never asked for.
  const selected = items.find((item) => item.value === value) ?? null;

  return (
    <ComboboxContext.Provider value={context}>
      <ComboboxPrimitive.Root
        items={items as ComboboxOption[]}
        value={selected}
        open={open}
        onOpenChange={handleOpenChange}
        onValueChange={(next) => onValueChange?.((next as ComboboxOption | null)?.value ?? "")}
        // What the input shows for a selection, and what the query is matched
        // against. The label carries both the code and the name, so a merchant
        // who knows `SG` need not remember how the list spells Singapore.
        itemToStringLabel={(item) => (item as ComboboxOption).label}
        actionsRef={actionsRef as React.RefObject<ComboboxPrimitive.Root.Actions>}
        {...props}
      />
    </ComboboxContext.Provider>
  );
}

function ComboboxInput({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <div className="relative">
      <ComboboxPrimitive.Input
        data-slot="combobox-input"
        className={cn(
          "flex h-8 w-full cursor-text items-center border border-input bg-card px-2.5 pr-8 text-left text-sm text-foreground transition-colors duration-150",
          "placeholder:text-subtle-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          "disabled:cursor-not-allowed disabled:bg-muted disabled:text-subtle-foreground",
          "aria-invalid:border-destructive",
          className,
        )}
        {...props}
      />
      <ComboboxPrimitive.Trigger
        data-slot="combobox-trigger"
        aria-label="Open the list"
        className="absolute inset-y-0 right-0 flex cursor-pointer items-center px-2.5"
      >
        <CaretUpDownIcon size={14} aria-hidden="true" className="shrink-0 text-subtle-foreground" />
      </ComboboxPrimitive.Trigger>
    </div>
  );
}

function ComboboxContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Popup> & { sideOffset?: number }) {
  const { open, actionsRef } = React.useContext(ComboboxContext);
  return (
    <AnimatePresence onExitComplete={() => actionsRef.current?.unmount()}>
      {open && (
        <ComboboxPrimitive.Portal>
          <ComboboxPrimitive.Positioner sideOffset={sideOffset} className="z-50">
            <ComboboxPrimitive.Popup
              data-slot="combobox-content"
              className={cn(
                "max-h-64 min-w-(--anchor-width) origin-top overflow-y-auto border border-border bg-popover py-1 text-popover-foreground shadow-sm",
                className,
              )}
              render={
                <motion.div
                  variants={popupVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                />
              }
              {...props}
            >
              {children}
            </ComboboxPrimitive.Popup>
          </ComboboxPrimitive.Positioner>
        </ComboboxPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

function ComboboxList(props: React.ComponentProps<typeof ComboboxPrimitive.List>) {
  return <ComboboxPrimitive.List data-slot="combobox-list" {...props} />;
}

function ComboboxEmpty({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("px-2.5 py-3 text-sm text-subtle-foreground", className)}
      {...props}
    />
  );
}

function ComboboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 px-2.5 py-1.5 text-sm text-foreground transition-colors duration-150",
        "data-highlighted:bg-muted data-selected:font-medium",
        "data-disabled:cursor-not-allowed data-disabled:text-subtle-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator>
        <CheckIcon size={12} weight="bold" aria-hidden="true" className="text-brand" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

export { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList };
