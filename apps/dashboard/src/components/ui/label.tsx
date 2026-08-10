import type * as React from "react";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // A reusable primitive cannot know its control: callers pass `htmlFor`.
    // Wrapping the control instead would also be wrong here, because the Base
    // UI checkbox renders a <button>, which a wrapping label does not toggle.
    // biome-ignore lint/a11y/noLabelWithoutControl: explained above
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-1 text-xs font-medium text-muted-foreground select-none",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
