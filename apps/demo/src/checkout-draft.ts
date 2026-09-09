/**
 * The transient checkout draft, kept in sessionStorage so a refresh or a stray
 * back does not lose an in-progress shipping step.
 *
 * The draft is the only thing "Buy now" writes — the cart is never touched,
 * so an abandoned shipping step leaves it exactly as it was.
 */

const DRAFT_KEY = "parahyangan-supply:checkout-draft";

export interface CheckoutDraftLine {
  readonly productId: string;
  readonly quantity: number;
}

export interface CheckoutDraft {
  readonly source: "cart" | "buy_now";
  readonly items: readonly CheckoutDraftLine[];
}

function isDraftLine(value: unknown): value is CheckoutDraftLine {
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

function isDraft(value: unknown): value is CheckoutDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as { source?: unknown; items?: unknown };
  return (
    (draft.source === "cart" || draft.source === "buy_now") &&
    Array.isArray(draft.items) &&
    draft.items.every(isDraftLine)
  );
}

export function saveDraft(draft: CheckoutDraft): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A blocked storage means a refresh loses the draft — annoying, not fatal.
  }
}

export function loadDraft(): CheckoutDraft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to recover from.
  }
}
