import { CheckoutButton } from "./CheckoutButton.tsx";
import { formatIdrMinorUnits } from "./money.ts";
import { CURRENCY } from "./ProductCard.tsx";
import type { DemoProduct } from "./types.ts";

export interface CartLine {
  readonly product: DemoProduct;
  readonly quantity: number;
}

function unitAmount(line: CartLine): bigint {
  const price = line.product.prices.find((entry) => entry.asset === CURRENCY);
  return price === undefined ? 0n : BigInt(price.amount);
}

export function CartDrawer({
  lines,
  open,
  onClose,
  onQuantity,
  onRemove,
}: {
  readonly lines: readonly CartLine[];
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onQuantity: (productId: string, quantity: number) => void;
  readonly onRemove: (productId: string) => void;
}) {
  if (!open) return null;

  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + unitAmount(line) * BigInt(line.quantity), 0n);

  return (
    <div className="cart-layer">
      <button type="button" className="cart-backdrop" onClick={onClose} aria-label="Close cart" />
      <aside className="cart-drawer" aria-label="Shopping cart">
        <div className="cart-head">
          <div>
            <p className="kicker">Your order</p>
            <h2>Cart ({itemCount})</h2>
          </div>
          <button type="button" className="cart-close" onClick={onClose} aria-label="Close cart">
            ×
          </button>
        </div>

        {lines.length === 0 ? (
          <p className="cart-empty">Your cart is empty. Choose a piece from the collection.</p>
        ) : (
          <>
            <ul className="cart-lines">
              {lines.map((line) => (
                <li key={line.product.id}>
                  <div className="cart-line-copy">
                    <strong>{line.product.name}</strong>
                    <span>{formatIdrMinorUnits(unitAmount(line) * BigInt(line.quantity))}</span>
                  </div>
                  <div className="cart-line-actions">
                    <div className="stepper">
                      <button
                        type="button"
                        onClick={() => onQuantity(line.product.id, line.quantity - 1)}
                        aria-label={`Decrease ${line.product.name}`}
                      >
                        −
                      </button>
                      <output>{line.quantity}</output>
                      <button
                        type="button"
                        onClick={() => onQuantity(line.product.id, line.quantity + 1)}
                        disabled={line.quantity >= 9}
                        aria-label={`Increase ${line.product.name}`}
                      >
                        +
                      </button>
                    </div>
                    <button
                      type="button"
                      className="cart-remove"
                      onClick={() => onRemove(line.product.id)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="cart-summary">
              <span>Total</span>
              <strong>{formatIdrMinorUnits(total)}</strong>
            </div>
            <CheckoutButton
              lines={lines.map((line) => ({ productId: line.product.id, quantity: line.quantity }))}
              label="Checkout cart"
              purchaseName={`${lines.length} products`}
              purchaseQuantity={itemCount}
              total={formatIdrMinorUnits(total)}
            />
          </>
        )}
      </aside>
    </div>
  );
}
