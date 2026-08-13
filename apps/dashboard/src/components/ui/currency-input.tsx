import type * as React from "react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { formatAmountInput, normalizeAmountInput, symbolOf } from "@/lib/pricing";

interface CurrencyInputProps
  extends Omit<React.ComponentProps<typeof InputGroupInput>, "onChange" | "value"> {
  readonly asset: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
}

/** A locale-aware money field whose external value stays API-safe and exact. */
function CurrencyInput({ asset, value, onValueChange, ...props }: CurrencyInputProps) {
  return (
    <InputGroup>
      <InputGroupAddon aria-hidden={false}>{symbolOf(asset)}</InputGroupAddon>
      <InputGroupInput
        inputMode="decimal"
        value={formatAmountInput(value)}
        onChange={(event) => {
          const normalized = normalizeAmountInput(event.target.value, asset);
          if (normalized !== undefined) onValueChange(normalized);
        }}
        {...props}
      />
    </InputGroup>
  );
}

export { CurrencyInput };
