import { chainLogoUrl } from "@mayarin/chain";
import clsx from "clsx";

/**
 * The networks a payment can arrive on. Base, Arbitrum and Arc resolve through
 * `chainLogoUrl`, the same function the hosted checkout renders from.
 *
 * Ethereum has no entry in `CHAIN_IDS`, so it carries a local mark — it is
 * named because the product says so, not because the chain registry does. The
 * mark is local rather than Trust Wallet's because theirs is a dark diamond on
 * a white disc, which vanishes into a light section.
 */
export const NETWORKS = [
  { name: "Ethereum", src: "/chains/ethereum.svg" },
  { name: "Arbitrum", src: chainLogoUrl("arbitrum") },
  { name: "Arc", src: chainLogoUrl("arc-testnet") },
  { name: "Base", src: chainLogoUrl("base") },
] as const;

/** Overlapped into a stack, so the ring has to be painted in the section's own ground. */
export function NetworkMarks({
  ring = "ring-v2-mist",
  class: className = "",
}: {
  readonly ring?: string;
  readonly class?: string;
}) {
  return (
    <div class={clsx("flex items-center -space-x-2", className)}>
      {NETWORKS.map((network) =>
        network.src ? (
          <img
            key={network.name}
            src={network.src}
            alt={network.name}
            title={network.name}
            width="26"
            height="26"
            loading="lazy"
            decoding="async"
            class={clsx("size-6.5 shrink-0 rounded-full object-contain ring-2", ring)}
          />
        ) : undefined,
      )}
    </div>
  );
}
