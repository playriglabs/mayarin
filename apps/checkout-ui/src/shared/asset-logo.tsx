import { assetLogoUrl } from "@mayarin/shared";
import polygonLogo from "./polygon.svg";
import usdtLogo from "./usdt.svg";

export function AssetLogo({
  symbol,
  size = 24,
  className = "",
}: {
  readonly symbol: string;
  readonly size?: number;
  /** Overrides the size from inside a container, e.g. the rail mark's `size-full`. */
  readonly className?: string;
}) {
  const source = assetLogoUrl(symbol, usdtLogo, polygonLogo);
  if (source === undefined) {
    return (
      <span
        className={`inline-grid shrink-0 place-items-center rounded-full border border-line bg-field text-[10px] font-medium text-muted ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {symbol.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className={`shrink-0 rounded-full object-contain ${className}`}
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
