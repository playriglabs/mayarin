const LOGO_DEV_TOKEN = "pk_aZrjrKFiSZWx7V4DeoMlwQ";

function logoUrl(symbol: string, size: number): string {
  const params = new URLSearchParams({
    token: LOGO_DEV_TOKEN,
    size: String(size),
    format: "png",
    theme: "auto",
    retina: "true",
    fallback: "monogram",
  });
  return `https://img.logo.dev/crypto/${encodeURIComponent(symbol.toLowerCase())}?${params.toString()}`;
}

export function AssetLogo({
  symbol,
  size = 24,
}: {
  readonly symbol: string;
  readonly size?: number;
}) {
  return (
    <img
      className="asset-logo"
      src={logoUrl(symbol, size)}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
    />
  );
}
