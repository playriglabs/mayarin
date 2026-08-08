import type * as React from "react";
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="skeleton" className={cn("h-8 animate-pulse bg-muted", className)} {...props} />
  );
}

export { Skeleton };
