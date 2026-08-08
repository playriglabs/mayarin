import type * as React from "react";
import { cn } from "@/lib/utils";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center gap-2 border border-dashed border-input bg-card px-6 py-12 text-center",
        className,
      )}
      {...props}
    />
  );
}

function EmptyMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-media"
      aria-hidden="true"
      className={cn("text-subtle-foreground", className)}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-title"
      className={cn("text-sm text-subtle-foreground", className)}
      {...props}
    />
  );
}

export { Empty, EmptyMedia, EmptyTitle };
