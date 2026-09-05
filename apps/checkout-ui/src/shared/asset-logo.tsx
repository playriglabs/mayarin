import { assetLogoUrl } from "@mayarin/shared";

export function AssetLogo({
  symbol,
  size = 24,
}: {
  readonly symbol: string;
  readonly size?: number;
}) {
  const source = assetLogoUrl(symbol);
  if (source === undefined) {
    return (
      <span
        className="asset-logo asset-logo-fallback"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {symbol.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className="asset-logo"
      src={source}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
    />
  );
}
