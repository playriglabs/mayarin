import { assetLogoUrl } from "@mayarin/shared";
import { cn } from "@/lib/utils";

function AssetLogo({
  symbol,
  size = 20,
  className,
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  const source = assetLogoUrl(symbol);
  if (source === undefined) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className={cn(
          "inline-grid shrink-0 place-items-center rounded-full bg-muted font-medium text-[0.6em] text-muted-foreground",
          className,
        )}
      >
        {symbol.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={source}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={cn("shrink-0 rounded-full object-contain", className)}
    />
  );
}

function AssetLabel({
  symbol,
  size = 20,
  className,
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <AssetLogo symbol={symbol} size={size} />
      <span>{symbol}</span>
    </span>
  );
}

function AssetAmount({
  asset,
  display,
  size = 18,
  className,
}: {
  asset: string;
  display: string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <AssetLogo symbol={asset} size={size} />
      <span>{display}</span>
    </span>
  );
}

/**
 * Several assets as one overlapping group, the way `ChainStack` draws networks.
 * Each disc carries a ring in the card's colour so they separate while touching.
 * Decorative: the caller names the assets in text for assistive technology.
 */
function AssetStack({
  assets,
  size = 20,
  className,
}: {
  readonly assets: readonly string[];
  readonly size?: number;
  readonly className?: string;
}) {
  if (assets.length === 0) return null;
  return (
    <span className={cn("flex items-center", className)} aria-hidden="true">
      {assets.map((asset, index) => (
        <AssetLogo
          key={asset}
          symbol={asset}
          size={size}
          className={cn("rounded-[50%] ring-2 ring-card", index > 0 && "-ml-2")}
        />
      ))}
    </span>
  );
}

export { AssetAmount, AssetLabel, AssetLogo, AssetStack };
