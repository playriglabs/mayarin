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

export { AssetAmount, AssetLabel, AssetLogo };
