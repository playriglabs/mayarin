import { chainLabel, chainLogoUrl } from "@mayarin/chain";
import { assetLogoUrl } from "@mayarin/shared";

/**
 * The network as the landing names it. `chainLabel` answers "Arc Testnet",
 * which is right in the product and wrong here — the marketing page names the
 * network, not the deployment it currently runs against.
 */
function networkName(chain: string): string {
  if (chain === "ethereum") return "Ethereum";
  return chainLabel(chain).replace(/ (Testnet|Sepolia)$/, "");
}

/**
 * One rail as a single mark: the token, badged with its network.
 *
 * The marks resolve through `assetLogoUrl` and `chainLogoUrl` — the same
 * functions the hosted checkout renders from — so the landing cannot drift into
 * showing a token the product does not actually offer.
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
  const assetLogo = assetLogoUrl(asset);
  // Ethereum is a marketing-only rail today, so it uses the same local mark as
  // `NetworkMarks` without pretending it is already a product `ChainId`.
  // Everything the product supports continues through the canonical helper.
  const chainLogo = chain === "ethereum" ? "/chains/ethereum.svg" : chainLogoUrl(chain);
  const badge = Math.round(size * 0.45);

  return (
    <span
      class="relative inline-grid shrink-0 place-items-center leading-none"
      style={`width:${size}px;height:${size}px`}
    >
      {assetLogo ? (
        <img
          src={assetLogo}
          alt=""
          aria-hidden="true"
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          class="size-full shrink-0 rounded-full object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          class="inline-grid size-full place-items-center rounded-full border border-line bg-paper text-[10px] font-semibold text-slate-600"
        >
          {asset.slice(0, 1).toUpperCase()}
        </span>
      )}
      {chainLogo && (
        <span
          aria-hidden="true"
          class="absolute right-0 bottom-0 inline-grid translate-x-[18%] translate-y-[18%] place-items-center overflow-hidden rounded-full bg-paper ring-2 ring-paper"
          style={`width:${badge}px;height:${badge}px`}
        >
          <img
            src={chainLogo}
            alt=""
            width={badge}
            height={badge}
            decoding="async"
            class="size-full rounded-full object-contain"
          />
        </span>
      )}
      <span class="sr-only">{`${asset} on ${networkName(chain)}`}</span>
    </span>
  );
}

export { networkName };
