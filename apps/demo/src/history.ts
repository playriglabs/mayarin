/**
 * Purchase history, kept on the buyer's device.
 *
 * A payment link has no receipt URL yet — the hosted checkout page owns the
 * payer flow, and a merchant backend learns outcomes through webhooks. So the
 * storefront records what it minted (product, quantity, total, the hosted
 * checkout URL) in `localStorage` at checkout time, and the history section
 * links each entry back to its payment page.
 */

const STORAGE_KEY = "parahyangan-supply:history";
const MAX_ENTRIES = 20;

export interface PurchaseEntry {
  readonly linkId: string;
  readonly name: string;
  readonly quantity: number;
  /** Human form of the line total, e.g. `Rp 598.000,00`. */
  readonly total: string;
  readonly url: string;
  /** ISO 8601 timestamp of the checkout. */
  readonly at: string;
}

export function loadHistory(): readonly PurchaseEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PurchaseEntry[]) : [];
  } catch {
    return [];
  }
}

export function recordPurchase(entry: PurchaseEntry): void {
  try {
    const next = [entry, ...loadHistory()].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked storage must not stop the checkout.
  }
}

const TIME_FORMAT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}
