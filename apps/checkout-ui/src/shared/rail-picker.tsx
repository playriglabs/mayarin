import { chainLabel } from "@mayarin/chain";
import { AssetLogo } from "./asset-logo.tsx";
import type { Rail } from "./types.ts";

/**
 * Which rail the payer pays on: the network first, then the asset (#244).
 *
 * Network first because it is the choice that narrows the other one — Base can
 * take ETH and Arc cannot, and offering a payer an asset that does not exist on
 * the network they are about to send from is how funds go somewhere nobody
 * watches.
 *
 * **One rail renders no chooser at all.** A single-chain deployment must look
 * exactly as it did before this existed; a chooser with one option is a
 * question with one answer, and asking it makes the page slower to read for
 * everyone it does not help. The same rule applies one level down: one network
 * with several assets shows the assets and no network row.
 *
 * `aria-pressed` rather than a radio group, matching the asset control this
 * grew out of: these are toggles in the visual design, and the pressed state is
 * what a screen reader has to read back.
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
  const chains = [...new Set(rails.map((rail) => rail.chain))];
  const chain = selected?.chain ?? chains[0];
  const assets = rails.filter((rail) => rail.chain === chain);

  // Nothing to choose. The page states the one rail in prose instead.
  if (rails.length <= 1) return null;

  const block = className === "" ? "form-block" : `form-block ${className}`;

  return (
    <>
      {chains.length > 1 && (
        <div className={block}>
          <span className="label">Network</span>
          <div className="networks">
            {chains.map((choice) => (
              <button
                type="button"
                className="network"
                key={choice}
                aria-pressed={choice === chain}
                onClick={() => {
                  // Switching network switches asset too: the previous asset may
                  // not exist here, and carrying it over would leave the page
                  // showing a pair that cannot be paid.
                  const first = rails.find((rail) => rail.chain === choice);
                  if (first !== undefined) onSelect(first);
                }}
              >
                {chainLabel(choice)}
              </button>
            ))}
          </div>
        </div>
      )}

      {assets.length > 1 && (
        <div className={block}>
          <span className="label">Pay with</span>
          <div className="assets">
            {assets.map((rail) => (
              <button
                type="button"
                className="asset"
                key={`${rail.chain}:${rail.asset}`}
                aria-pressed={rail.asset === selected?.asset && rail.chain === selected?.chain}
                onClick={() => onSelect(rail)}
              >
                <AssetLogo symbol={rail.asset} />
                {rail.asset}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** "USDC on Arc Testnet" — the rail in one line, for a page with nothing to ask. */
export function railSummary(rail: Rail | undefined): string {
  return rail === undefined ? "" : `${rail.asset} on ${chainLabel(rail.chain)}`;
}
