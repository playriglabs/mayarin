import { chainLabel } from "@mayarin/chain";
import { AssetLogo } from "./asset-logo.tsx";
import { ChainLogo } from "./chain-logo.tsx";

/**
 * One rail as a single mark: the token, badged with its network.
 *
 * A payment rail is a pair, and two marks side by side read as two options
 * rather than as one — "USDC, Arc" instead of "USDC on Arc". Overlapping the
 * chain onto the token's corner is what makes a row of them scannable: the
 * payer sees which asset first, and which network without a second line.
 *
 * The title is the accessible answer, since both images are decorative.
 */
export function RailMark({
  asset,
  chain,
  size = 32,
}: {
  readonly asset: string;
  readonly chain: string;
  readonly size?: number;
}) {
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center leading-none"
      style={{ width: size, height: size }}
    >
      <AssetLogo symbol={asset} size={size} className="size-full" />
      <span
        className="absolute right-0 bottom-0 inline-grid translate-x-[18%] translate-y-[18%] place-items-center overflow-hidden rounded-full bg-panel ring-2 ring-panel"
        style={{ width: size * 0.5, height: size * 0.5 }}
      >
        <ChainLogo chain={chain} size={Math.round(size * 0.5)} className="size-full" />
      </span>
      <span className="sr-only">{`${asset} on ${chainLabel(chain)}`}</span>
    </span>
  );
}
