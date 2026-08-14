import { Brand } from "./Brand.tsx";
import type { LinkLine, MerchantRef } from "./types.ts";

export function CheckoutSummary({
  merchant,
  title,
  totalDisplay,
  lines,
}: {
  readonly merchant: MerchantRef;
  readonly title: string;
  readonly totalDisplay: string;
  readonly lines: readonly LinkLine[] | null;
}) {
  return (
    <aside className="checkout-summary" aria-label="Order summary">
      <div className="summary-inner">
        <Brand />
        <p className="merchant-name">
          {merchant.name}
          {merchant.city.trim() === "" ? null : ` — ${merchant.city}`}
        </p>
        <h1>{title}</h1>
        <p className="summary-total">{totalDisplay}</p>

        {lines !== null && lines.length > 0 && (
          <div className="product-list">
            {lines.map((line) => (
              <article className="product" key={`${line.name}-${line.unitPrice.amount}`}>
                {line.imageUrl === null ? (
                  <div className="product-placeholder" aria-hidden="true">
                    {line.name.slice(0, 1).toUpperCase()}
                  </div>
                ) : (
                  <img
                    className="product-image"
                    src={line.imageUrl}
                    alt=""
                    width="72"
                    height="72"
                    loading="lazy"
                    decoding="async"
                  />
                )}
                <div className="product-copy">
                  <div className="product-heading">
                    <strong>{line.name}</strong>
                    <strong>{line.lineTotal.display}</strong>
                  </div>
                  {line.description !== null && <p>{line.description}</p>}
                  <span>
                    {line.unitPrice.display} × {line.quantity}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="summary-spacer" />
        <a className="powered-by" href="https://mayarin.xyz" target="_blank" rel="noreferrer">
          Powered by <strong>mayarin.xyz</strong>
        </a>
      </div>
    </aside>
  );
}
