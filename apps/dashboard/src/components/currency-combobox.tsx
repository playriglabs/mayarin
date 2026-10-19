/** Picks the currency money is shown in. Options are whatever the rate table quotes. */

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  type ComboboxOption,
} from "@/components/ui/combobox";
import { useCurrencies } from "@/hooks/fx";

const NAMES = new Intl.DisplayNames("en", { type: "currency" });

/** Listed first, in this order; everything else follows by name. */
const COMMON = ["USD", "EUR", "GBP"];

function nameOf(code: string): string {
  return NAMES.of(code) ?? code;
}

/** What the closed field shows and what a search matches against. */
function label(code: string): string {
  return `${code} - ${nameOf(code)}`;
}

function byCommonThenName(a: string, b: string): number {
  const rank = (code: string) => {
    const index = COMMON.indexOf(code);
    return index === -1 ? COMMON.length : index;
  };
  return rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b));
}

export function CurrencyCombobox({
  id,
  value,
  onChange,
  disabled,
  inputClassName,
}: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (code: string) => void;
  readonly disabled?: boolean;
  readonly inputClassName?: string;
}) {
  const currencies = useCurrencies();
  const items = [...(currencies.data?.currencies ?? [])].sort(byCommonThenName).map((code) => ({
    value: code,
    label: label(code),
  }));

  return (
    <Combobox items={items} value={value} onValueChange={onChange} disabled={disabled === true}>
      <ComboboxInput
        id={id}
        placeholder="Search currency or code"
        {...(inputClassName === undefined ? {} : { className: inputClassName })}
      />
      <ComboboxContent align="start" className="max-h-80 w-(--anchor-width)">
        <ComboboxEmpty>No currency matches that.</ComboboxEmpty>
        <ComboboxList>
          {(currency: ComboboxOption) => (
            <ComboboxItem key={currency.value} value={currency}>
              <span className="flex min-w-0 items-baseline gap-3">
                <span className="w-9 shrink-0 text-xs text-subtle-foreground">
                  {currency.value}
                </span>
                <span className="truncate">{nameOf(currency.value)}</span>
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
