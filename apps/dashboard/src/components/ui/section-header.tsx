import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Section header — the landing's mono eyebrow with its electric square,
 * carried into the product as the heading for every content section. It sits
 * OUTSIDE the surface it names (a table, a chart, a panel), which is what
 * keeps the surfaces themselves quiet.
 */
function SectionHeader({
  title,
  action,
  className,
  ...props
}: {
  title: string;
  action?: React.ReactNode;
} & React.ComponentProps<"div">) {
  return (
    <div
      data-slot="section-header"
      className={cn("flex items-baseline justify-between gap-3", className)}
      {...props}
    >
      <h2 className="label flex items-center gap-2.5 text-muted-foreground mt-4">
        <span aria-hidden="true" className="inline-block size-1.5 bg-electric" />
        {title}
      </h2>
      {action}
    </div>
  );
}

export { SectionHeader };
