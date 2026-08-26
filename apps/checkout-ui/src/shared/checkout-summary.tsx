import { Brand } from "./brand.tsx";
import { PoweredBy } from "./powered-by.tsx";
import type { LineItem, MerchantRef } from "./types.ts";

/**
 * What is being bought, on the left of both checkout pages. The link page and
 * the payment page show the same summary so the buyer sees one order across the
 * two steps, not two descriptions of it.
 */
export function CheckoutSummary({
  merchant,
  title,
  totalDisplay,
  lines,
}: {
  readonly merchant: MerchantRef;
  readonly title: string;
  readonly totalDisplay: string;
  readonly lines: readonly LineItem[] | null;
}) {
  return (
    <aside className="checkout-summary" aria-label="Order summary">
      <div className="summary-inner">
        <Brand />
        <p className="merchant-name mb-5">
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
        <PoweredBy />
      </div>
    </aside>
  );
}
