import { useEffect, useRef } from "react";
import { CheckoutButton } from "./CheckoutButton.tsx";
import { markCartCheckout } from "./cart-storage.ts";
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

/**
 * The cart as a native `<dialog>`: the browser carries the focus trap, the
 * Escape key, and focus return to the cart trigger. The component only opens
 * and closes it to match the `open` prop and locks the page scroll behind it.
 */
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
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + unitAmount(line) * BigInt(line.quantity), 0n);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click only closes on the ::backdrop; the keyboard path is the dialog's native Escape.
    <dialog
      ref={ref}
      className="cart-dialog"
      aria-label="Shopping cart"
      onClose={onClose}
      onClick={(event) => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect === undefined) return;
        const outside =
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom;
        if (outside) ref.current?.close();
      }}
    >
      <div className="cart-head">
        <div>
          <p className="kicker">Your order</p>
          <h2>Cart ({itemCount})</h2>
        </div>
        <button
          type="button"
          className="cart-close"
          onClick={() => ref.current?.close()}
          aria-label="Close cart"
        >
          ×
        </button>
      </div>

      {lines.length === 0 ? (
        <div className="cart-empty">
          <p>Your cart is empty.</p>
          <button type="button" className="cart-continue" onClick={() => ref.current?.close()}>
            Continue shopping
          </button>
        </div>
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
                      disabled={line.quantity <= 1}
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
            onRedirect={markCartCheckout}
          />
        </>
      )}
    </dialog>
  );
}
