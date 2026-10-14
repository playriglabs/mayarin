import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { chevron, fieldLabel } from "./ui.ts";

/**
 * One choice among a list, drawn the one way checkout draws it.
 *
 * The selected option is the only row visible at rest; opening it floats a
 * bounded, scrollable radio list over the form, so the page below does not jump.
 * It started as the rail picker and was lifted out so that every list on a
 * payment page — the asset and network, the currency, the bank — looks and
 * behaves the same, rather than three of them being the browser's own `<select>`.
 */

export interface DropdownOption {
  readonly value: string;
  readonly title: string;
  readonly subtitle?: string;
  /** A mark drawn before the text, given the size the row wants. */
  readonly mark?: (size: number) => ReactNode;
}

export function Dropdown({
  label,
  options,
  value,
  onSelect,
  placeholder = "Choose",
  disabled = false,
  className = "",
}: {
  readonly label: string;
  readonly options: readonly DropdownOption[];
  /** The chosen option's value, or `""` for none yet. */
  readonly value: string;
  readonly onSelect: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);

  // A floating list closes the way a menu does: a click outside, or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={className}>
      <span className={fieldLabel} id={`${listId}-label`}>
        {label}
      </span>
      {/* The list floats over the form rather than pushing it down. */}
      <div ref={anchorRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className={`flex min-h-14 w-full items-center gap-2.5 rounded-xl border bg-field px-4 py-2 text-left text-ink transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
            open ? "border-muted" : "border-transparent enabled:hover:border-line"
          }`}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((previous) => !previous)}
        >
          {current === undefined ? (
            <span className="min-w-0 flex-1 text-[13px] text-muted">{placeholder}</span>
          ) : (
            <>
              {current.mark?.(24)}
              <OptionCopy option={current} />
            </>
          )}
          {/* A rotated square's corner sits below its box's centre; nudged so
              the chevron lines up with the word beside it. */}
          <span className="flex items-center gap-2 text-xs leading-none text-muted">
            Change
            <span
              className={`${chevron} size-1.5 ${open ? "translate-y-0.5 -rotate-135" : "-translate-y-1 rotate-45"}`}
              aria-hidden="true"
            />
          </span>
        </button>

        {/* Closed, the list is also zero-height and clipped: a transparent
            absolute box still counts toward the page's scrollable area. */}
        <div
          id={listId}
          className={`absolute inset-x-0 top-full z-30 mt-2 origin-top transition-[opacity,translate,scale] duration-200 ease-out motion-reduce:transition-none ${
            open
              ? "visible translate-y-0 scale-100 opacity-100"
              : "pointer-events-none invisible max-h-0 -translate-y-1 scale-[0.98] overflow-hidden opacity-0"
          }`}
          aria-hidden={!open}
          inert={!open}
        >
          <div
            className="max-h-80 overflow-y-auto overscroll-contain rounded-xl border border-line bg-panel p-1 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45)]"
            role="radiogroup"
            aria-labelledby={`${listId}-label`}
          >
            {options.map((option) => {
              const checked = option.value === value;
              return (
                <label
                  className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-ink transition-colors duration-150 hover:bg-field has-checked:bg-field has-focus-visible:outline-2 has-focus-visible:outline-brand"
                  key={option.value}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={listId}
                    checked={checked}
                    onChange={() => {
                      onSelect(option.value);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                  />
                  {option.mark?.(22)}
                  <OptionCopy option={option} />
                  <span
                    className={`size-3.5 shrink-0 rounded-full border ${
                      checked ? "border-4 border-ink" : "border-line"
                    }`}
                    aria-hidden="true"
                  />
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionCopy({ option }: { readonly option: DropdownOption }) {
  return (
    <span className="grid min-w-0 flex-1 leading-tight">
      <span className="text-[13px] text-ink">{option.title}</span>
      {option.subtitle !== undefined && (
        <span className="text-[11px] text-muted">{option.subtitle}</span>
      )}
    </span>
  );
}
