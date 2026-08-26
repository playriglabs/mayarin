import { Popover } from "@base-ui-components/react/popover";
import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface DatePickerProps {
  readonly id: string;
  readonly value: string;
  readonly min?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly onValueChange: (value: string) => void;
}

function parseIso(value: string): Date | undefined {
  const match = ISO_DATE.exec(value);
  if (match === null) return undefined;
  const [, year, month, day] = match;
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toIso(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function calendarDays(month: Date): readonly Date[] {
  const first = startOfMonth(month);
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return date;
  });
}

const dateLabel = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const monthLabel = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const accessibleDateLabel = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "full",
  timeZone: "UTC",
});

function DatePicker({
  id,
  value,
  min,
  placeholder = "dd/mm/yyyy",
  disabled = false,
  onValueChange,
}: DatePickerProps) {
  const selected = parseIso(value);
  const minimum = min === undefined ? undefined : parseIso(min);
  const today = startOfMonth(new Date());
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selected ?? today));
  const days = useMemo(() => calendarDays(visibleMonth), [visibleMonth]);

  function choose(date: Date) {
    onValueChange(toIso(date));
    setOpen(false);
  }

  return (
    <Popover.Root
      open={disabled ? false : open}
      onOpenChange={(next) => {
        if (disabled) return;
        if (next && selected !== undefined) setVisibleMonth(startOfMonth(selected));
        setOpen(next);
      }}
    >
      <Popover.Trigger
        id={id}
        disabled={disabled}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center justify-between gap-2 border border-input bg-card px-2.5 text-left text-sm text-foreground transition-colors duration-150",
          // Matches the shared Select's disabled treatment, so a filter row
          // reads as one control group whichever field is looked at.
          "disabled:cursor-not-allowed disabled:bg-muted disabled:text-subtle-foreground",
        )}
      >
        <span className={cn(value === "" && "text-subtle-foreground")}>
          {selected === undefined ? placeholder : dateLabel.format(selected)}
        </span>
        <CalendarBlankIcon size={16} aria-hidden="true" />
      </Popover.Trigger>

      <Popover.Portal>
        {/* Dialogs sit at z-70. The calendar is portalled outside the dialog,
            so it must occupy the popup layer above them rather than inheriting
            the dialog's stacking context. This matches the shared Select. */}
        <Popover.Positioner sideOffset={4} align="start" className="z-80">
          <Popover.Popup className="w-72 border border-input bg-popover p-3 text-popover-foreground shadow-sm focus-visible:outline-none">
            <div className="mb-2 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Previous month"
                onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
              >
                <CaretLeftIcon size={16} aria-hidden="true" />
              </Button>
              <p aria-live="polite" className="font-medium text-sm">
                {monthLabel.format(visibleMonth)}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Next month"
                onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
              >
                <CaretRightIcon size={16} aria-hidden="true" />
              </Button>
            </div>

            <div className="grid grid-cols-7">
              {WEEKDAYS.map((weekday) => (
                <abbr
                  key={weekday}
                  title={weekday}
                  className="flex size-9 items-center justify-center font-mono text-[10px] text-muted-foreground uppercase no-underline"
                >
                  {weekday.slice(0, 1)}
                </abbr>
              ))}
              {days.map((date) => {
                const iso = toIso(date);
                const outside = date.getUTCMonth() !== visibleMonth.getUTCMonth();
                const isSelected = iso === value;
                const disabled = minimum !== undefined && date < minimum;
                return (
                  <button
                    key={iso}
                    type="button"
                    aria-label={accessibleDateLabel.format(date)}
                    aria-pressed={isSelected}
                    disabled={disabled}
                    onClick={() => choose(date)}
                    className={cn(
                      "size-9 cursor-pointer text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-30",
                      outside && "text-subtle-foreground",
                      isSelected &&
                        "bg-brand text-brand-foreground hover:bg-brand dark:bg-electric dark:text-black",
                    )}
                  >
                    {date.getUTCDate()}
                  </button>
                );
              })}
            </div>

            <div className="mt-2 flex justify-between border-border border-t pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onValueChange("");
                  setOpen(false);
                }}
              >
                Clear
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const now = new Date();
                  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
                  if (minimum === undefined || date >= minimum) choose(date);
                }}
              >
                Today
              </Button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export { DatePicker };
