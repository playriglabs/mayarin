/**
 * A small info mark that explains a setting on hover or focus.
 *
 * For the part of a description a merchant needs once, not every time: the field
 * keeps one short line, and the rule behind it lives here. The text is also the
 * button's accessible name, so a screen reader has it whether or not the popup
 * ever opens.
 */

import { InfoIcon } from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function InfoHint({ text }: { readonly text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={text}
              className="cursor-help text-subtle-foreground transition-colors hover:text-foreground"
            >
              <InfoIcon size={15} aria-hidden="true" />
            </button>
          }
        />
        <TooltipContent className="max-w-72">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
