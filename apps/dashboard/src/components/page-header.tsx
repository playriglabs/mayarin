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
    <header
      className={cn("flex flex-wrap items-start justify-between gap-4", className)}
      {...props}
    >
      <div className="flex flex-col gap-1">
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
