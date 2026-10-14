/**
 * A local payment method as the merchant should see it: the provider's mark and
 * the method's name — nothing about the currency, which has its own column.
 *
 * Wherever a payment was paid with a rupiah QR or an e-wallet, the rail is named
 * this way instead of by the chain the stablecoin happens to land on.
 */

export function PaymentMethodMark({
  name,
  logoUrl,
  size = 14,
}: {
  readonly name: string;
  readonly logoUrl: string | null;
  readonly size?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {logoUrl !== null && (
        // The marks are drawn for a light ground, and some are dark, so each sits
        // on white in both themes.
        <span
          className="grid shrink-0 place-items-center rounded bg-white p-px"
          style={{ width: size + 4, height: size + 4 }}
        >
          <img
            src={logoUrl}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            className="object-contain"
          />
        </span>
      )}
      <span className="text-sm text-foreground">{name}</span>
    </span>
  );
}
