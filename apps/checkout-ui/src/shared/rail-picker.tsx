import { chainLabel } from "@mayarin/chain";
import { useEffect, useId, useRef, useState } from "react";
import { RailMark } from "./rail-mark.tsx";
import type { Rail } from "./types.ts";
import { chevron, fieldLabel } from "./ui.ts";

/**
 * A rail is one valid asset + network pair, so it is selected as one thing.
 *
 * Keeping the pair together prevents invalid combinations and scales without
 * turning checkout into two walls of buttons. The selected rail is the only
 * row visible at rest; opening it floats a bounded, scrollable radio list over
 * the form, so the page below does not jump.
 * Server order is preserved, so the merchant's configured preference is the
 * default. One rail renders no chooser because a question with one answer adds
 * friction.
 */
export function RailPicker({
  rails,
  selected,
  onSelect,
  className = "",
}: {
  readonly rails: readonly Rail[];
  readonly selected: Rail | undefined;
  readonly onSelect: (rail: Rail) => void;
  /** Extra classes on the block — the invoice hides it from the printed page. */
  readonly className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const current = selected ?? rails[0];

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

  if (rails.length <= 1 || current === undefined) return null;

  return (
    <div className={`mt-6 ${className}`}>
      <span className={fieldLabel} id={`${listId}-label`}>
        Pay with
      </span>
      {/* The list floats over the form rather than pushing it down. */}
      <div ref={anchorRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          className={`flex min-h-14 w-full items-center gap-2.5 rounded-xl border bg-field px-4 py-2 text-left text-ink transition-colors duration-200 ${
            open ? "border-muted" : "border-transparent hover:border-line"
          }`}
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => setOpen((value) => !value)}
        >
          <RailMark asset={current.asset} chain={current.chain} size={24} />
          <RailCopy rail={current} />
          {/* A rotated square's corner sits below its box's centre; nudged so
              the chevron lines up with the word beside it. */}
          <span className="flex items-center gap-2 text-xs leading-none text-muted">
            Change
            <span
              className={`${chevron} size-1.5 ${open ? "translate-y-0.5 -rotate-135" : "-translate-y-0.5"}`}
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
            {rails.map((rail) => {
              const checked = rail.asset === current.asset && rail.chain === current.chain;
              return (
                <label
                  className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-ink transition-colors duration-150 hover:bg-field has-checked:bg-field has-focus-visible:outline-2 has-focus-visible:outline-brand"
                  key={`${rail.chain}:${rail.asset}`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name={listId}
                    checked={checked}
                    onChange={() => {
                      onSelect(rail);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                  />
                  <RailMark asset={rail.asset} chain={rail.chain} size={22} />
                  <RailCopy rail={rail} />
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

function RailCopy({ rail }: { readonly rail: Rail }) {
  return (
    <span className="grid min-w-0 flex-1 leading-tight">
      <span className="text-[13px] text-ink">{rail.asset}</span>
      <span className="text-[11px] text-muted">{chainLabel(rail.chain)}</span>
    </span>
  );
}

/** "USDC on Arc Testnet" — the rail in one line, for a page with nothing to ask. */
export function railSummary(rail: Rail | undefined): string {
  return rail === undefined ? "" : `${rail.asset} on ${chainLabel(rail.chain)}`;
}
