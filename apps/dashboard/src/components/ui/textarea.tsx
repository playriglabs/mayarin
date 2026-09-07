import type * as React from "react";
import { cn } from "@/lib/utils";

/** The other native control this app keeps. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full rounded-lg border border-input bg-card px-2.5 py-2 text-sm leading-5 text-foreground",
        "placeholder:text-subtle-foreground",
        "disabled:bg-muted disabled:text-subtle-foreground",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
