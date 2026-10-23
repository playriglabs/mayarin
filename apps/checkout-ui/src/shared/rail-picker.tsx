import { chainLabel } from "@mayarin/chain";
import { Dropdown } from "./dropdown.tsx";
import { RailMark } from "./rail-mark.tsx";
import type { Rail } from "./types.ts";

/** More rails than this and the list gets a search field. */
const SEARCH_FROM = 8;

/**
 * A rail is one valid asset + network pair, so it is selected as one thing.
 *
 * Keeping the pair together prevents invalid combinations and scales without
 * turning checkout into two walls of buttons. Server order is preserved, so the
 * merchant's configured preference is the default. One rail renders no chooser
 * because a question with one answer adds friction.
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
  const current = selected ?? rails[0];
  if (rails.length <= 1 || current === undefined) return null;

  return (
    <Dropdown
      className={`mt-6 ${className}`}
      label="Pay with"
      searchable={rails.length > SEARCH_FROM}
      value={railKey(current)}
      options={rails.map((rail) => ({
        value: railKey(rail),
        title: rail.asset,
        subtitle: chainLabel(rail.chain),
        mark: (size: number) => <RailMark asset={rail.asset} chain={rail.chain} size={size} />,
      }))}
      onSelect={(key) => {
        const rail = rails.find((candidate) => railKey(candidate) === key);
        if (rail !== undefined) onSelect(rail);
      }}
    />
  );
}

function railKey(rail: Rail): string {
  return `${rail.chain}:${rail.asset}`;
}

/** "USDC on Arc Testnet" — the rail in one line, for a page with nothing to ask. */
export function railSummary(rail: Rail | undefined): string {
  return rail === undefined ? "" : `${rail.asset} on ${chainLabel(rail.chain)}`;
}
