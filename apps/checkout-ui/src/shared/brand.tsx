import type { MerchantRef } from "./types.ts";

const MAYARIN_LOGO_DARK = "https://mayarin.xyz/brand-kit/mayarin-logo-white.svg";
const MAYARIN_LOGO_LIGHT = "https://mayarin.xyz/brand-kit/mayarin-logo-black.svg";

/**
 * Who is being paid, at the top of the order: the merchant's logo when they
 * uploaded one — the buyer is paying them, not us — and the Mayarin mark
 * otherwise. "Powered by" at the bottom keeps the
 * attribution either way.
 */
export function Brand({
  merchant,
  label,
}: {
  readonly merchant: MerchantRef;
  /** Beside the mark. The invoice leaves it out: its "From" names the merchant. */
  readonly label?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {merchant.logoUrl !== null ? (
        <img
          src={merchant.logoUrl}
          alt={merchant.name}
          width="32"
          height="32"
          className="size-8 rounded-full border border-line object-cover"
        />
      ) : (
        <a
          href="https://mayarin.xyz"
          aria-label="Mayarin home"
          className="grid size-8 place-items-center rounded-full border border-line"
        >
          <img
            src={MAYARIN_LOGO_LIGHT}
            alt=""
            width="18"
            height="18"
            className="size-4.5 dark:hidden"
          />
          <img
            src={MAYARIN_LOGO_DARK}
            alt="Mayarin"
            width="18"
            height="18"
            className="hidden size-4.5 object-contain dark:block"
          />
        </a>
      )}
      {label !== undefined && <span className="text-base text-ink">{label}</span>}
    </div>
  );
}
