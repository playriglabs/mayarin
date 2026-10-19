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
import { currencyFlag } from "@/lib/country-currency";

const NAMES = new Intl.DisplayNames("en", { type: "currency" });

function label(code: string): string {
  const name = NAMES.of(code);
  const text = name === undefined || name === code ? code : `${code} - ${name}`;
  return `${currencyFlag(code)} ${text}`;
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
  const items = (currencies.data?.currencies ?? []).map((code) => ({
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
              {currency.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
