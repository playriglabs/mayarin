import { chainLogoUrl } from "@mayarin/chain";
import clsx from "clsx";

/**
 * The networks a payment can arrive on. Solana, Base, Arbitrum and Arc
 * resolve through `chainLogoUrl`, the same function the hosted
 * checkout renders from.
 *
 * Ethereum and Polygon have no entry in `CHAIN_IDS`, so they carry local marks —
 * they are named because the product says so, not because the chain registry
 * does. Ethereum's is local rather than Trust Wallet's because theirs is a dark
 * diamond on a white disc, which vanishes into a light section; Polygon's is the
 * official mark as a plain vector path, white on its purple disc like the rest.
 */
export const NETWORKS = [
  { name: "Ethereum", src: "/chains/ethereum.svg" },
  { name: "Solana", src: chainLogoUrl("solana-devnet") },
  { name: "Base", src: chainLogoUrl("base") },
  { name: "Arbitrum", src: chainLogoUrl("arbitrum") },
  { name: "Polygon", src: "/chains/polygon.svg" },
  { name: "Arc", src: chainLogoUrl("arc-testnet") },
] as const;

export interface Mark {
  readonly name: string;
  readonly src: string | undefined;
}

/**
 * Logos overlapped into a stack, each naming itself in a tooltip on hover or
 * keyboard focus. The ring has to be painted in the section's own ground.
 */
export function MarkStack({
  marks,
  label,
  ring = "ring-v2-mist",
  class: className = "",
}: {
  readonly marks: readonly Mark[];
  /** Names the list for assistive tech, e.g. "Settlement stablecoins". */
  readonly label: string;
  readonly ring?: string;
  readonly class?: string;
}) {
  return (
    <ul aria-label={label} class={clsx("flex items-center -space-x-2", className)}>
      {marks.map((mark) =>
        mark.src ? (
          <li
            key={mark.name}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Focus reveals the tooltip for keyboard users.
            tabIndex={0}
            class="group relative rounded-full outline-offset-2 hover:z-10 focus-visible:z-10"
          >
            <img
              src={mark.src}
              alt={mark.name}
              width="26"
              height="26"
              loading="lazy"
              decoding="async"
              class={clsx(
                "size-6.5 shrink-0 rounded-full object-contain ring-2 transition-transform duration-200 group-hover:-translate-y-0.5",
                ring,
              )}
            />
            <span
              aria-hidden="true"
              class="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] font-medium text-paper opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              {mark.name}
            </span>
          </li>
        ) : undefined,
      )}
    </ul>
  );
}
