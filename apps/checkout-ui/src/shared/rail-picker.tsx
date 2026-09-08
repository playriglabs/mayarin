import { chainLabel } from "@mayarin/chain";
import { useId, useRef, useState } from "react";
import { RailMark } from "./rail-mark.tsx";
import type { Rail } from "./types.ts";

/**
 * A rail is one valid asset + network pair, so it is selected as one thing.
 *
 * Keeping the pair together prevents invalid combinations and scales without
 * turning checkout into two walls of buttons. The selected rail is the only
 * row visible at rest; opening it reveals a bounded, scrollable radio list.
 * Server order is preserved: the API ranks by what the rails have been doing
 * (#260), so the healthiest rail is the one offered first. A degraded rail
 * stays selectable and carries a note — the payer who holds only that asset
 * must still be able to pay. One rail renders no chooser because a question
 * with one answer adds friction.
 */

/** The one line a degraded rail is allowed to say (#260). */
const DEGRADED_NOTE = "settling slower than usual";
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
  const current = selected ?? rails[0];

  if (rails.length <= 1 || current === undefined) return null;

  const block = className === "" ? "form-block" : `form-block ${className}`;

  return (
    <div className={block}>
      <span className="label" id={`${listId}-label`}>
        Pay with
      </span>
      <button
        ref={triggerRef}
        type="button"
        className="rail-picker-trigger"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <RailMark asset={current.asset} chain={current.chain} size={30} />
        <span className="rail-picker-copy">
          <strong>{current.asset}</strong>
          <span>{chainLabel(current.chain)}</span>
        </span>
        <span className="rail-picker-change">Change</span>
        <span className="rail-picker-chevron" aria-hidden="true" />
      </button>
      {current.standing === "degraded" && (
        <span className="rail-standing rail-standing-trigger">{DEGRADED_NOTE}</span>
      )}

      <div
        id={listId}
        className={`rail-options-collapse${open ? " open" : ""}`}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="rail-options-clip">
          <div className="rail-options" role="radiogroup" aria-labelledby={`${listId}-label`}>
            {rails.map((rail) => {
              const checked = rail.asset === current.asset && rail.chain === current.chain;
              return (
                <label className="rail-option" key={`${rail.chain}:${rail.asset}`}>
                  <input
                    type="radio"
                    name={listId}
                    checked={checked}
                    onChange={() => {
                      onSelect(rail);
                      setOpen(false);
                      triggerRef.current?.focus();
                    }}
                  />
                  <RailMark asset={rail.asset} chain={rail.chain} size={28} />
                  <span className="rail-picker-copy">
                    <strong>{rail.asset}</strong>
                    <span>{chainLabel(rail.chain)}</span>
                    {rail.standing === "degraded" && (
                      <span className="rail-standing">{DEGRADED_NOTE}</span>
                    )}
                  </span>
                  <span className="rail-option-check" aria-hidden="true" />
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "USDC on Arc Testnet" — the rail in one line, for a page with nothing to ask. */
export function railSummary(rail: Rail | undefined): string {
  return rail === undefined ? "" : `${rail.asset} on ${chainLabel(rail.chain)}`;
}
