import { AssetLogo } from "./asset-logo.tsx";

/**
 * Which asset the payer sends. The link page and the invoice page ask the same
 * question, so they ask it with the same control.
 *
 * `aria-pressed` rather than a radio group: these are toggles in the visual
 * design, and the pressed state is what a screen reader has to read back.
 */
export function AssetPicker({
  accepted,
  selected,
  onSelect,
  className = "",
}: {
  readonly accepted: readonly string[];
  readonly selected: string | undefined;
  readonly onSelect: (asset: string) => void;
  /** Extra classes on the block — the invoice hides it from the printed page. */
  readonly className?: string;
}) {
  return (
    <div className={className === "" ? "form-block" : `form-block ${className}`}>
      <span className="label">Pay with</span>
      <div className="assets">
        {accepted.map((choice) => (
          <button
            type="button"
            className="asset"
            key={choice}
            aria-pressed={choice === selected}
            onClick={() => onSelect(choice)}
          >
            <AssetLogo symbol={choice} />
            {choice}
          </button>
        ))}
      </div>
    </div>
  );
}
