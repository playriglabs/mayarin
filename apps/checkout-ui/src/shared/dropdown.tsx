import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n/index.tsx";
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
  placeholder,
  disabled = false,
  searchable = false,
  compact = false,
  className = "",
}: {
  readonly label: string;
  readonly options: readonly DropdownOption[];
  /** The chosen option's value, or `""` for none yet. */
  readonly value: string;
  readonly onSelect: (value: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  /** Adds a search field above the list, for a list too long to scan. */
  readonly searchable?: boolean;
  /**
   * A small pill instead of a full-width field, its list opening against the right
   * edge: for a setting that sits in a corner, like the language, not a form field.
   */
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);
  const needle = query.trim().toLowerCase();
  const shown =
    needle === ""
      ? options
      : options.filter((option) =>
          `${option.title} ${option.subtitle ?? ""}`.toLowerCase().includes(needle),
        );

  // A floating list closes the way a menu does: a click outside, or Escape.
  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    if (searchable) searchRef.current?.focus();
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
  }, [open, searchable]);

  return (
    <div className={className}>
      <span className={compact ? "sr-only" : fieldLabel} id={`${listId}-label`}>
        {label}
      </span>
      {/* The list floats over the form rather than pushing it down. */}
      <div ref={anchorRef} className={compact ? "relative inline-block" : "relative"}>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className={
            compact
              ? `flex min-h-9 items-center gap-2 rounded-full border bg-transparent px-3 py-1.5 text-xs text-muted transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 enabled:hover:text-ink ${
                  open ? "border-muted text-ink" : "border-line enabled:hover:border-muted"
                }`
              : `flex min-h-12 w-full items-center gap-3 rounded-xl border bg-field px-3.5 py-1.5 text-left text-ink transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
                  open ? "border-muted" : "border-transparent enabled:hover:border-line"
                }`
          }
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((previous) => !previous)}
        >
          {current === undefined ? (
            <span className="min-w-0 flex-1 text-sm text-muted">{placeholder ?? t("choose")}</span>
          ) : compact ? (
            <>
              {current.mark?.(16)}
              <span>{current.title}</span>
            </>
          ) : (
            <>
              {current.mark?.(28)}
              <OptionCopy option={current} />
            </>
          )}
          {/* A rotated square's corner sits below its box's centre; nudged so
              the chevron lines up with the word beside it. */}
          <span className="flex items-center gap-2 text-xs leading-none text-muted">
            {compact ? null : t("change")}
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
          className={`absolute top-full z-30 mt-2 transition-[opacity,translate,scale] duration-200 ease-out motion-reduce:transition-none ${
            compact ? "right-0 w-60 origin-top-right" : "inset-x-0 origin-top"
          } ${
            open
              ? "visible translate-y-0 scale-100 opacity-100"
              : "pointer-events-none invisible max-h-0 -translate-y-1 scale-[0.98] overflow-hidden opacity-0"
          }`}
          aria-hidden={!open}
          inert={!open}
        >
          <div className="overflow-hidden rounded-xl border border-line bg-panel shadow-[0_16px_40px_-12px_rgb(0_0_0/0.45)]">
            {searchable && (
              <div className="flex items-center gap-2 border-b border-line px-3">
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  ref={searchRef}
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t("searchAssetOrNetwork")}
                  aria-label={t("searchAssetOrNetwork")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full border-0 bg-transparent py-3 text-sm text-ink outline-none placeholder:text-muted"
                />
              </div>
            )}
            <div
              className="max-h-72 overflow-y-auto overscroll-contain p-1"
              role="radiogroup"
              aria-labelledby={`${listId}-label`}
            >
              {shown.length === 0 && (
                <p className="m-0 px-3 py-3 text-sm text-muted">
                  Nothing matches "{query.trim()}".
                </p>
              )}
              {shown.map((option) => {
                const checked = option.value === value;
                return (
                  <label
                    className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-1.5 text-left text-ink transition-colors duration-150 hover:bg-field has-checked:bg-field has-focus-visible:outline-2 has-focus-visible:outline-brand"
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
                    {option.mark?.(26)}
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
    </div>
  );
}

function OptionCopy({ option }: { readonly option: DropdownOption }) {
  return (
    <span className="grid min-w-0 flex-1 leading-tight">
      <span className="text-[13px] text-ink">{option.title}</span>
      {option.subtitle !== undefined && (
        <span className="text-xs text-muted">{option.subtitle}</span>
      )}
    </span>
  );
}
