/**
 * The cart, kept on the buyer's device.
 *
 * Only product ids and quantities are stored — the catalog stays the truth
 * for names and prices, so a stored line whose product no longer exists
 * drops out when the cart is joined against the loaded catalog.
 *
 * A cart checkout marks itself in sessionStorage before the redirect. The
 * success page clears the stored cart only when that mark is present, so a
 * single-product "Buy now" never empties an unrelated cart.
 */

const STORAGE_KEY = "parahyangan-supply:cart";
const CART_CHECKOUT_KEY = "parahyangan-supply:cart-checkout";

export interface StoredCartLine {
  readonly productId: string;
  readonly quantity: number;
}

function isStoredCartLine(value: unknown): value is StoredCartLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as { productId?: unknown; quantity?: unknown };
  return (
    typeof line.productId === "string" &&
    typeof line.quantity === "number" &&
    Number.isInteger(line.quantity) &&
    line.quantity >= 1 &&
    line.quantity <= 9
  );
}

export function loadCart(): readonly StoredCartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isStoredCartLine) : [];
  } catch {
    return [];
  }
}

export function saveCart(lines: readonly StoredCartLine[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // A full or blocked storage must not break the cart.
  }
}

export function markCartCheckout(): void {
  try {
    window.sessionStorage.setItem(CART_CHECKOUT_KEY, "1");
  } catch {
    // Without the mark the cart survives the checkout — annoying, not fatal.
  }
}

export function clearCartAfterCheckout(): void {
  try {
    if (window.sessionStorage.getItem(CART_CHECKOUT_KEY) === null) return;
    window.sessionStorage.removeItem(CART_CHECKOUT_KEY);
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage failure must not hide the payment success page.
  }
}
