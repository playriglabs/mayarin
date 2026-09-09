/**
 * The cart, kept on the buyer's device.
 *
 * Only product ids and quantities are stored — the catalog stays the truth
 * for names and prices, so a stored line whose product no longer exists
 * drops out when the cart is joined against the loaded catalog.
 *
 * A cart-sourced order is cleared at the shipping step, once the order is
 * persisted — a "Buy now" checkout never touches the cart at all.
 */

const STORAGE_KEY = "parahyangan-supply:cart";

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
