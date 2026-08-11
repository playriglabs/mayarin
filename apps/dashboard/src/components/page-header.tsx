import type * as React from "react";
import { cn } from "@/lib/utils";

function PageHeader({
  title,
  description,
  actions,
  className,
  ...props
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
} & React.ComponentProps<"header">) {
  return (
    // The bottom hairline is the page's first rule — every surface below
    // hangs from it, which is what makes the pages read as one ledger.
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5 mb-4",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-medium text-foreground">{title}</h1>
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

export { PageHeader };
