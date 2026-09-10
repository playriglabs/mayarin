import { Tooltip as TooltipPrimitive } from "@base-ui-components/react/tooltip";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tooltip, on Base UI.
 *
 * Written because the `title` attribute is not a tooltip. The browser decides
 * whether to draw it, when, and where; it takes about a second to appear, it
 * never appears for a keyboard user, and on a touch screen it does not exist at
 * all. Anywhere a badge hides information behind `+N`, that information is
 * unreachable for anyone not hovering a mouse patiently.
 *
 * Base UI supplies what makes this an accessible tooltip rather than a floating
 * div: it opens on focus as well as hover, closes on Escape, and is wired to
 * its trigger by `aria-describedby`. The `Provider` shortens the delay after
 * the first one has been shown, which is what makes scanning a table of them
 * feel instant rather than sticky.
 *
 * A tooltip is for supplementary text. Anything a reader must have belongs in
 * the page — the `+N` badge still carries its full list in an `aria-label`, so
 * a screen reader gets it whether or not this ever opens.
 */

function TooltipProvider({
  delay = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delay={delay} {...props} />;
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />;
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Popup> & {
  readonly sideOffset?: number;
}) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner sideOffset={sideOffset} className="z-70">
        <TooltipPrimitive.Popup
          className={cn(
            "max-w-xs rounded-lg border border-border bg-popover px-2.5 py-1.5 text-popover-foreground text-xs shadow-md",
            className,
          )}
          {...props}
        >
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
