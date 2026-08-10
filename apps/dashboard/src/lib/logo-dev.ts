const LOGO_DEV_TOKEN = "pk_aZrjrKFiSZWx7V4DeoMlwQ";

export function cryptoLogoUrl(symbol: string, size: number): string {
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
