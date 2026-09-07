import type * as React from "react";
import { cn } from "@/lib/utils";

/** One of the two native controls this app keeps. See `input-group` for addons. */
function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 text-sm text-foreground",
        "placeholder:text-subtle-foreground",
        "disabled:bg-muted disabled:text-subtle-foreground",
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
