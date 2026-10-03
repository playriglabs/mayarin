import type { MerchantRef } from "./types.ts";

const BRAND_KIT_LOGO_URL = "https://mayarin.xyz/brand-kit/mayarin-white.png";

/**
 * The mark at the top of a buyer page: the merchant's own logo when they
 * uploaded one — the buyer is paying them, not us — and the Mayarin mark
 * otherwise. "Powered by" at the bottom keeps the attribution either way.
 */
export function Brand({ merchant }: { readonly merchant: MerchantRef }) {
  if (merchant.logoUrl !== null) {
    return (
      <span className="brand brand-merchant">
        <img src={merchant.logoUrl} alt={merchant.name} width="40" height="40" />
      </span>
    );
  }
  return (
    <a className="brand" href="https://mayarin.xyz" aria-label="Mayarin home">
      <img src={BRAND_KIT_LOGO_URL} alt="Mayarin" width="40" height="40" />
    </a>
  );
}
