import { cryptoLogoUrl } from "@/lib/logo-dev";
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
  return (
    <img
      src={cryptoLogoUrl(symbol, size)}
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
