/**
 * Purchase history, kept on the buyer's device.
 *
 * A payment link has no receipt URL yet — the hosted checkout page owns the
 * payer flow, and a merchant backend learns outcomes through webhooks. So the
 * storefront records the pending checkout locally, then the success route
 * replaces that link-oriented state with the verified payment-intent id.
 */

const STORAGE_KEY = "parahyangan-supply:history";
const PENDING_LINK_KEY = "parahyangan-supply:pending-link";
const MAX_ENTRIES = 20;

export interface PurchaseEntry {
  readonly linkId: string;
  readonly name: string;
  readonly quantity: number;
  /** Human form of the line total, e.g. `Rp 598.000,00`. */
  readonly total: string;
  readonly url: string;
  readonly paymentId?: string;
  readonly status?: "successful";
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
    window.sessionStorage.setItem(PENDING_LINK_KEY, entry.linkId);
  } catch {
    // A full or blocked storage must not stop the checkout.
  }
}

export function recordSuccessfulPayment(paymentId: string): void {
  try {
    const entries = loadHistory();
    const pendingLinkId = window.sessionStorage.getItem(PENDING_LINK_KEY);
    const linkedIndex =
      pendingLinkId === null ? -1 : entries.findIndex((entry) => entry.linkId === pendingLinkId);
    const targetIndex =
      linkedIndex === -1
        ? entries.findIndex((entry) => entry.paymentId === undefined)
        : linkedIndex;
    if (targetIndex === -1) return;
    const next = entries.map((entry, index) =>
      index === targetIndex ? { ...entry, paymentId, status: "successful" as const } : entry,
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.sessionStorage.removeItem(PENDING_LINK_KEY);
  } catch {
    // Storage failure must not hide a verified payment success page.
  }
}

const TIME_FORMAT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}
