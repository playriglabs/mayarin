import type * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function PageHeader({
  title,
  description,
  actions,
  actionHref,
  actionLabel,
  className,
  ...props
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Static-page shortcut without requiring Astro to construct a React node. */
  actionHref?: string;
  actionLabel?: string;
} & React.ComponentProps<"header">) {
  return (
    // The bottom hairline is the page's first rule — every surface below
    // hangs from it, which is what makes the pages read as one ledger.
    <header
      className={cn("mb-7 flex flex-wrap items-center justify-between gap-4", className)}
      {...props}
    >
      <div className="flex flex-col">
        <h1 className="font-sans text-[28px] font-medium tracking-[-0.025em] text-foreground">
          {title}
        </h1>
        {description !== undefined && (
          <p className="text-base text-muted-foreground mt-3">{description}</p>
        )}
      </div>
      {(actions !== undefined || (actionHref !== undefined && actionLabel !== undefined)) && (
        <div className="flex items-center gap-2">
          {actions}
          {actionHref !== undefined && actionLabel !== undefined && (
            <a href={actionHref} className={buttonVariants({ size: "default" })}>
              {actionLabel}
            </a>
          )}
        </div>
      )}
    </header>
  );
}

export { PageHeader };
