import { Switch as SwitchPrimitive } from "@base-ui-components/react/switch";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Switch, on Base UI — an on/off setting that takes effect as a whole, where a
 * checkbox would read as one item ticked in a list.
 *
 * `Switch.Root` renders a `<button role="switch">`, so an external
 * `<label htmlFor>` names and toggles it, the same as the checkbox.
 */
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-input p-0.5 transition-colors duration-150",
        "data-checked:bg-brand",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-disabled:cursor-not-allowed data-disabled:opacity-60",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="size-4 rounded-full bg-white shadow-sm transition-transform duration-150 data-checked:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
