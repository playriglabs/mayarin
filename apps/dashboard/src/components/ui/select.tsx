import { Select as SelectPrimitive } from "@base-ui-components/react/select";
import { CaretUpDownIcon, CheckIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { PRESS_SCALE, popupVariants, pressTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Select, on Base UI.
 *
 * Base UI resolves the trigger's text from the `items` map on the root, NOT
 * from the rendered `SelectItem`s — the list lives in a portal that is not
 * mounted until the popup opens, so there is nothing to read a label from
 * before then. That is why `items` is required rather than merely convenient,
 * and why the same array is also held in context here for `SelectValue`.
 *
 * A caveat worth knowing when reading Base UI's source: `SelectValue`'s render
 * prop receives the raw VALUE, and supplying children DISABLES Base UI's own
 * label resolution. `SelectValue` below therefore does the lookup itself.
 *
 * ## How the exit animation works
 *
 * Base UI normally unmounts the popup the moment it closes, which is why a
 * naive setup fades in and then blinks out. `actionsRef` is Base UI's hook for
 * exactly this case — it exists for when the animation is owned by an external
 * library. The sequence:
 *
 *   1. The root is CONTROLLED, so `open` is readable here.
 *   2. `AnimatePresence` gates the portal, so closing runs the `exit` variant
 *      instead of removing the subtree immediately.
 *   3. Base UI holds its own teardown until `actionsRef.current.unmount()`,
 *      which `onExitComplete` calls once the fade has finished.
 */

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

interface SelectContextValue {
  readonly items: readonly SelectOption[];
  readonly open: boolean;
  readonly actionsRef: React.RefObject<SelectPrimitive.Root.Actions | null>;
}

const SelectContext = React.createContext<SelectContextValue>({
  items: [],
  open: false,
  actionsRef: { current: null },
});

function Select({
  items,
  open: openProp,
  defaultOpen,
  onOpenChange,
  onValueChange,
  ...props
}: Omit<
  React.ComponentProps<typeof SelectPrimitive.Root>,
  "items" | "onValueChange" | "actionsRef"
> & {
  items: readonly SelectOption[];
  /** Narrowed from Base UI's `unknown` — every option value here is a string. */
  onValueChange?: (value: string) => void;
}) {
  // Controlled internally when the caller does not control it, because
  // `AnimatePresence` has to read `open` to run the exit animation.
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
  const open = openProp ?? uncontrolledOpen;
  const actionsRef = React.useRef<SelectPrimitive.Root.Actions | null>(null);

  const handleOpenChange: NonNullable<
    React.ComponentProps<typeof SelectPrimitive.Root>["onOpenChange"]
  > = (next, details) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next, details);
  };

  const context = React.useMemo(() => ({ items, open, actionsRef }), [items, open]);

  return (
    <SelectContext.Provider value={context}>
      <SelectPrimitive.Root
        items={items as SelectOption[]}
        open={open}
        onOpenChange={handleOpenChange}
        onValueChange={(value) => onValueChange?.(String(value ?? ""))}
        actionsRef={actionsRef as React.RefObject<SelectPrimitive.Root.Actions>}
        {...props}
      />
    </SelectContext.Provider>
  );
}

function SelectTrigger({
  className,
  children,
  disabled,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      {...(disabled === undefined ? {} : { disabled })}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center justify-between gap-2 border border-input bg-card px-2.5 text-left text-sm text-foreground transition-colors duration-150",
        "data-disabled:cursor-not-allowed data-disabled:bg-muted data-disabled:text-subtle-foreground",
        "aria-invalid:border-destructive",
        className,
      )}
      render={
        <motion.button
          type="button"
          {...(disabled === true ? {} : { whileTap: { scale: PRESS_SCALE } })}
          transition={pressTransition}
        />
      }
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <CaretUpDownIcon size={14} aria-hidden="true" className="shrink-0 text-subtle-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({
  className,
  placeholder,
  renderValue,
  ...props
}: Omit<React.ComponentProps<typeof SelectPrimitive.Value>, "children"> & {
  placeholder?: string;
  renderValue?: (option: SelectOption) => React.ReactNode;
}) {
  const { items } = React.useContext(SelectContext);
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex min-w-0 items-center truncate", className)}
      {...props}
    >
      {(value: unknown) => {
        const match = items.find((item) => item.value === value);
        if (match !== undefined) return renderValue?.(match) ?? match.label;
        return <span className="text-subtle-foreground">{placeholder ?? ""}</span>;
      }}
    </SelectPrimitive.Value>
  );
}

function SelectContent({
  className,
  children,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> & { sideOffset?: number }) {
  const { open, actionsRef } = React.useContext(SelectContext);
  return (
    <AnimatePresence onExitComplete={() => actionsRef.current?.unmount()}>
      {open && (
        <SelectPrimitive.Portal>
          <SelectPrimitive.Positioner
            sideOffset={sideOffset}
            alignItemWithTrigger={false}
            className="z-50"
          >
            <SelectPrimitive.Popup
              data-slot="select-content"
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
              <SelectPrimitive.List>{children}</SelectPrimitive.List>
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 px-2.5 py-1.5 text-sm text-foreground transition-colors duration-150",
        "data-highlighted:bg-muted data-selected:font-medium",
        "data-disabled:cursor-not-allowed data-disabled:text-subtle-foreground",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <CheckIcon size={12} weight="bold" aria-hidden="true" className="text-brand" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.GroupLabel>) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2.5 py-1.5 text-xs font-medium text-subtle-foreground", className)}
      {...props}
    />
  );
}

export { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue };
