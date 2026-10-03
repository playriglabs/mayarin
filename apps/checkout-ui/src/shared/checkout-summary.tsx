import type { ReactNode } from "react";
import { Brand } from "./brand.tsx";
import { PoweredBy } from "./powered-by.tsx";
import type { LineItem, MerchantRef } from "./types.ts";

/** A long cart stays a summary: the first few lines, then a count of the rest. */
export const VISIBLE_LINES = 5;

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
  children,
}: {
  readonly merchant: MerchantRef;
  readonly title: string;
  readonly totalDisplay: string;
  readonly lines: readonly LineItem[] | null;
  /** Page-specific content under the order, e.g. the payment's progress. */
  readonly children?: ReactNode;
}) {
  return (
    <aside className="checkout-summary" aria-label="Order summary">
      <div className="summary-inner">
        <Brand merchant={merchant} />
        <p className="merchant-name mb-5">
          {merchant.name}
          {merchant.city.trim() === "" ? null : ` — ${merchant.city}`}
        </p>
        <h1>{title}</h1>
        <p className="summary-total">{totalDisplay}</p>

        {lines !== null && lines.length > 0 && (
          <div className="product-list">
            {lines.slice(0, VISIBLE_LINES).map((line) => (
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
            {lines.length > VISIBLE_LINES && (
              <p className="product-more">
                +{lines.length - VISIBLE_LINES} more{" "}
                {lines.length - VISIBLE_LINES === 1 ? "item" : "items"}
              </p>
            )}
          </div>
        )}

        {children}
        <div className="summary-spacer" />
        <PoweredBy />
      </div>
    </aside>
  );
}
