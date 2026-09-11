import { chainLabel } from "@mayarin/chain";
import { Fragment } from "react";

interface RailLike {
  readonly chain: string;
  readonly asset: string;
}

/** Rails grouped by network, in the order each network first appears. */
export function groupRailsByChain(
  rails: readonly RailLike[],
): readonly (readonly [string, readonly string[]])[] {
  const byChain = new Map<string, readonly string[]>();
  for (const rail of rails) {
    byChain.set(rail.chain, [...(byChain.get(rail.chain) ?? []), rail.asset]);
  }
  return [...byChain.entries()];
}

/**
 * The body of a "+N rails" tooltip: one row per network, its assets beside it.
 *
 * Grouped rather than one line per rail, because a network name repeated down
 * the list made a tall, narrow column that covered the table beneath it. Wide
 * and short reads at a glance and leaves the rows visible.
 */
export function RailGroups({ rails }: { readonly rails: readonly RailLike[] }) {
  return (
    <span className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      {groupRailsByChain(rails).map(([chain, assets]) => (
        <Fragment key={chain}>
          <span className="whitespace-nowrap text-muted-foreground">{chainLabel(chain)}</span>
          <span className="whitespace-nowrap">{assets.join(" · ")}</span>
        </Fragment>
      ))}
    </span>
  );
}
