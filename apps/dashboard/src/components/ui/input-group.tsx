import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A bordered frame holding one control plus leading/trailing addons — a search
 * icon, a currency prefix, a unit.
 *
 * The frame owns the border and the focus ring; the control inside is bare.
 * That is the point: floating an icon over a padded input with `absolute` makes
 * the icon overlap long text and forces the padding to be hand-tuned per icon.
 * Here the addon occupies real space and the control flexes into the rest.
 *
 * The ring uses `has-[:focus-visible]` rather than `focus-within`, so a mouse
 * click does not paint it but a keyboard tab does.
 */
function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "flex h-8 w-full items-center border border-input bg-card",
        "has-focus-visible:outline-2 has-focus-visible:outline-ring has-focus-visible:outline-offset-2",
        "has-disabled:bg-muted",
        "has-aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Addons are `aria-hidden` by default because they are decoration — the field
 * label already names the control. Pass `aria-hidden={false}` for an addon that
 * carries meaning the label does not, such as a currency code.
 */
function InputGroupAddon({
  className,
  "aria-hidden": ariaHidden = true,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="input-group-addon"
      aria-hidden={ariaHidden}
      className={cn(
        "flex shrink-0 items-center gap-1 px-2.5 text-xs text-subtle-foreground [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/** The control inside an `InputGroup`: no border, no ring, no width of its own. */
function InputGroupInput({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input-group-input"
      className={cn(
        "h-full min-w-0 flex-1 bg-transparent px-0 text-sm text-foreground outline-none",
        "placeholder:text-subtle-foreground disabled:text-subtle-foreground",
        // An addon supplies the padding on its side; without one the control needs it.
        "first:pl-2.5 last:pr-2.5",
        className,
      )}
      {...props}
    />
  );
}

/**
 * An interactive addon — a reveal toggle, a clear button, a unit picker.
 *
 * Separate from `InputGroupAddon` because that one is `aria-hidden` by default:
 * it is decoration, and burying a real control inside it would hide the control
 * from a screen reader entirely. This is a plain `Button`, so it keeps focus,
 * keyboard activation and the press animation.
 *
 * Defaults to `type="button"`, because the overwhelmingly common bug here is an
 * addon inside a form submitting it on click.
 */
function InputGroupButton({
  className,
  type = "button",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="input-group-button"
      type={type}
      variant="ghost"
      size="icon"
      className={cn("size-8 shrink-0", className)}
      {...props}
    />
  );
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput };
