import type * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Field — label, control, description and error as composable parts.
 *
 * This replaces a render-prop version that generated the control `id` from the
 * label text. Wiring is explicit now: the caller owns the `id` and passes it to
 * both `FieldLabel htmlFor` and the control. That is more typing and it is the
 * right trade — the old version silently collided when two fields on a page
 * shared a label, and there was no way to see it from the call site.
 */
function Field({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field" className={cn("flex flex-col gap-1.5", className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={className} {...props} />;
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-xs text-subtle-foreground", className)}
      {...props}
    />
  );
}

function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p data-slot="field-error" className={cn("text-xs text-destructive", className)} {...props} />
  );
}

/** A set of related fields — the shape a `<fieldset>` wants. */
function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset data-slot="field-set" className={cn("flex flex-col gap-2", className)} {...props} />
  );
}

function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) {
  return (
    <legend
      data-slot="field-legend"
      className={cn("mb-1 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet };
