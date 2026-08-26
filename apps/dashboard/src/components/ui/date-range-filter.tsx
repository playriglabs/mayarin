import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldLabel } from "@/components/ui/field";

interface DateRangeFilterProps {
  readonly from: string;
  readonly to: string;
  /** Locked while the list this filters is still loading its current page. */
  readonly disabled?: boolean;
  readonly onFromChange: (value: string) => void;
  readonly onToChange: (value: string) => void;
}

function DateRangeFilter({
  from,
  to,
  disabled = false,
  onFromChange,
  onToChange,
}: DateRangeFilterProps) {
  return (
    <>
      <Field>
        <FieldLabel htmlFor="list-from">From</FieldLabel>
        <DatePicker id="list-from" value={from} disabled={disabled} onValueChange={onFromChange} />
      </Field>
      <Field>
        <FieldLabel htmlFor="list-to">Before</FieldLabel>
        <DatePicker
          id="list-to"
          value={to}
          disabled={disabled}
          {...(from === "" ? {} : { min: from })}
          onValueChange={onToChange}
        />
      </Field>
    </>
  );
}

export { DateRangeFilter };
