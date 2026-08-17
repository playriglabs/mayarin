const BRAND_KIT_LOGO_URL = "https://mayarin.xyz/brand-kit/mayarin-white.png";

export function Brand() {
  return (
    <a className="brand" href="https://mayarin.xyz" aria-label="Mayarin home">
      <img src={BRAND_KIT_LOGO_URL} alt="Mayarin" width="40" height="40" />
    </a>
  );
}
