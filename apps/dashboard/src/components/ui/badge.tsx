import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Badge. `success` and `warning` are additions to shadcn's set — a payment
 * dashboard has more than two terminal states, and reusing `destructive` for
 * "in flight" would be a lie.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 px-2 py-0.5 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground",
        success: "bg-success-muted text-success",
        destructive: "bg-destructive-muted text-destructive",
        warning: "bg-warning-muted text-warning",
        brand: "bg-brand-muted text-brand",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
