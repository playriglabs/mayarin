import type * as React from "react";
import { cn } from "@/lib/utils";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center gap-2 border border-dashed border-input bg-card px-6 py-26 text-center",
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

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="empty-description"
      className={cn("max-w-md text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function EmptyAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="empty-action" className={cn("mt-5", className)} {...props} />;
}

export { Empty, EmptyAction, EmptyDescription, EmptyMedia, EmptyTitle };
