import { Checkbox as CheckboxPrimitive } from "@base-ui-components/react/checkbox";
import { CheckIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type * as React from "react";
import { PRESS_SCALE, pressTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Checkbox, on Base UI.
 *
 * `Checkbox.Root` renders a `<button role="checkbox">`. A button IS a labelable
 * element, so an external `<label htmlFor>` both names it and toggles it on
 * click — which WRAPPING it in a label would not have done.
 */
function Checkbox({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      {...(disabled === undefined ? {} : { disabled })}
      render={
        <motion.button
          type="button"
          {...(disabled === true ? {} : { whileTap: { scale: PRESS_SCALE } })}
          transition={pressTransition}
        />
      }
      className={cn(
        "flex size-4 shrink-0 cursor-pointer items-center justify-center border border-input bg-card transition-colors duration-150",
        "data-checked:border-primary data-checked:bg-primary",
        "data-disabled:cursor-not-allowed data-disabled:bg-muted",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator">
        <CheckIcon size={10} weight="bold" aria-hidden="true" className="text-primary-foreground" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
