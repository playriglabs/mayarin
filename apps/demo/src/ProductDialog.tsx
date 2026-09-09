import { useEffect, useRef, useState } from "react";
import { lineTotal } from "./money.ts";
import { CURRENCY } from "./ProductCard.tsx";
import { ProductImage } from "./product-art.tsx";
import type { DemoProduct } from "./types.ts";

const MAX_QUANTITY = 9;

/**
 * The product detail view: bigger art, the full description, a quantity
 * stepper, and the two actions that matter. "Buy now" starts a transient
 * checkout for this line alone — the cart is never touched. Native
 * `<dialog>` carries the focus trap and the Escape key.
 */
export function ProductDialog({
  product,
  onAddToCart,
  onBuyNow,
  onClose,
}: {
  readonly product: DemoProduct;
  readonly onAddToCart: (product: DemoProduct, quantity: number) => void;
  readonly onBuyNow: (product: DemoProduct, quantity: number) => void;
  readonly onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const price = product.prices.find((entry) => entry.asset === CURRENCY);

  return (
    <dialog ref={ref} className="product-dialog" onClose={onClose} aria-label={product.name}>
      <button
        type="button"
        className="dialog-close"
        onClick={() => ref.current?.close()}
        aria-label="Close"
      >
        ×
      </button>
      <div className="dialog-body">
        <div className="dialog-media">
          <ProductImage
            image={product.metadata.image}
            kind={product.metadata.kind}
            tone={product.metadata.tone}
            name={product.name}
          />
        </div>
        <div className="dialog-info">
          {product.metadata.category !== undefined && (
            <p className="kicker">{product.metadata.category}</p>
          )}
          <h2>{product.name}</h2>
          {product.description !== null && <p className="description">{product.description}</p>}
          {price === undefined ? (
            <p className="notice">Price unavailable.</p>
          ) : (
            <>
              <p className="price unit-price">{price.display}</p>
              <div className="quantity">
                <span>Quantity</span>
                <div className="stepper">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    disabled={quantity <= 1}
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <output>{quantity}</output>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(MAX_QUANTITY, q + 1))}
                    disabled={quantity >= MAX_QUANTITY}
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="dialog-buy">
                <p className="total-row">
                  <span className="total-label">Total</span>
                  <span className="price total">{lineTotal(price.amount, quantity)}</span>
                </p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      ref.current?.close();
                      onBuyNow(product, quantity);
                    }}
                  >
                    Buy now
                  </button>
                  <button
                    type="button"
                    className="add-to-cart"
                    onClick={() => {
                      onAddToCart(product, quantity);
                      ref.current?.close();
                    }}
                  >
                    Add to cart
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
