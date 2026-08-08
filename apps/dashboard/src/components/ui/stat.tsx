import type { Icon } from "@phosphor-icons/react";
import type * as React from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { ICON_CARD } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * Stat tile. Not a shadcn registry component — it is this product's own, kept
 * here so it composes with `Card` and stays consistent with the rest.
 *
 * `icon` takes the Phosphor component itself, not an element, so the 20px card
 * size stays this component's decision rather than each call site's.
 */
function Stat({
  label,
  value,
  hint,
  icon: IconComponent,
  className,
  ...props
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: Icon;
} & React.ComponentProps<typeof Card>) {
  return (
    <Card data-slot="stat" className={className} {...props}>
      <CardTitle>
        {IconComponent !== undefined && (
          <IconComponent
            size={ICON_CARD}
            weight="regular"
            aria-hidden="true"
            className="text-subtle-foreground"
          />
        )}
        {label}
      </CardTitle>
      <p className={cn("text-2xl font-medium text-foreground tabular-nums")}>{value}</p>
      {hint !== undefined && <p className="text-xs text-subtle-foreground">{hint}</p>}
    </Card>
  );
}

export { Stat };
