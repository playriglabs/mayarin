/**
 * Orders, kept on the buyer's device.
 *
 * An order is what the shipping step produces: the priced items plus the
 * address they ship to. It replaces the old per-line-item purchase history —
 * status belongs to the whole order, never to a single line. The one-time
 * migration folds the old records into synthetic orders so demo data made
 * before the order model still renders.
 */

const ORDERS_KEY = "parahyangan-supply:orders.v1";
/** The pre-order storage this module migrates from — read-only now. */
const LEGACY_HISTORY_SOURCE = "parahyangan-supply:history";
const MAX_ORDERS = 50;

export interface OrderItem {
  readonly productId: string;
  readonly name: string;
  /** Minor units as an integer string. The field for arithmetic. */
  readonly unitPrice: string;
  readonly qty: number;
}

export interface ShippingAddress {
  readonly recipientName: string;
  /** E.164-shaped international number, e.g. `+62 812 3456 7890`. */
  readonly phone: string;
  readonly addressLine1: string;
  /** Apartment, suite, unit, landmark — the optional second line. */
  readonly addressLine2?: string;
  readonly city: string;
  /** State, province, or region — whatever the country calls it. */
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
  readonly notes?: string;
}

export type OrderStatus = "pending_payment" | "paid" | "failed";
export type OrderSource = "cart" | "buy_now" | "legacy";

export interface Order {
  readonly id: string;
  readonly createdAt: number;
  readonly items: readonly OrderItem[];
  /** Minor units as an integer string. */
  readonly subtotal: string;
  readonly shipping: ShippingAddress | null;
  readonly status: OrderStatus;
  readonly source: OrderSource;
  /** The Payment Intent this order was checked out as. */
  readonly paymentId?: string;
  /** The hosted payment page for a `pending_payment` order. */
  readonly paymentUrl?: string;
}

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID-shaped: 10 time chars keep orders sortable, 16 random chars keep ids unique. */
export function newOrderId(now = Date.now()): string {
  let time = now;
  let timestamp = "";
  for (let i = 0; i < 10; i += 1) {
    timestamp = ULID_ALPHABET.charAt(time % 32) + timestamp;
    time = Math.floor(time / 32);
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let random = "";
  for (const byte of bytes) random += ULID_ALPHABET.charAt(byte % 32);
  return timestamp + random;
}

function isOrder(value: unknown): value is Order {
  if (typeof value !== "object" || value === null) return false;
  const order = value as Partial<Order>;
  return (
    typeof order.id === "string" &&
    typeof order.createdAt === "number" &&
    Array.isArray(order.items) &&
    typeof order.subtotal === "string" &&
    (order.shipping === null || typeof order.shipping === "object") &&
    (order.status === "pending_payment" || order.status === "paid" || order.status === "failed") &&
    (order.source === "cart" || order.source === "buy_now" || order.source === "legacy")
  );
}

/** Reverses `formatIdrMinorUnits` for the one-time migration of old records. */
function legacyTotalToMinorUnits(display: string): string {
  const [, whole = "0", cents = "0"] = /^Rp ([\d.]+),(\d{2})$/.exec(display) ?? [];
  return `${whole.replaceAll(".", "")}${cents}`;
}

interface LegacyEntry {
  readonly linkId: string;
  readonly name: string;
  readonly quantity: number;
  readonly total: string;
  readonly paymentId?: string;
  readonly status?: "successful";
  readonly at: string;
}

function readLegacyEntries(): readonly LegacyEntry[] {
  try {
    const raw = window.localStorage.getItem(LEGACY_HISTORY_SOURCE);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as LegacyEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Folds the old per-item records into synthetic orders, grouped by identical
 * timestamp — the one entry a checkout wrote carries the whole cart, so a
 * group is the closest thing to the order it once was.
 */
function migrateLegacyHistory(): readonly Order[] {
  const entries = readLegacyEntries();
  const groups: { at: string; entries: LegacyEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last !== undefined && last.at === entry.at) last.entries.push(entry);
    else groups.push({ at: entry.at, entries: [entry] });
  }
  return groups.map((group, index) => {
    const first = group.entries[0] ?? {
      linkId: "",
      name: "",
      quantity: 0,
      total: "Rp 0,00",
      at: group.at,
    };
    return {
      id: newOrderId(Date.parse(group.at) + index),
      createdAt: Date.parse(group.at),
      items: group.entries.map((entry) => ({
        productId: "",
        name: entry.name,
        unitPrice: legacyTotalToMinorUnits(entry.total),
        qty: 1,
      })),
      subtotal: group.entries
        .reduce((sum, entry) => sum + BigInt(legacyTotalToMinorUnits(entry.total)), 0n)
        .toString(),
      shipping: null,
      status: group.entries.some((entry) => entry.status === "successful")
        ? ("paid" as const)
        : ("pending_payment" as const),
      source: "legacy" as const,
      ...(first.paymentId === undefined ? {} : { paymentId: first.paymentId }),
    };
  });
}

export function loadOrders(): readonly Order[] {
  try {
    const raw = window.localStorage.getItem(ORDERS_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isOrder) : [];
    }
    // No orders yet: this is the first read on a device with old demo data.
    const migrated = migrateLegacyHistory();
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return [];
  }
}

export function addOrder(order: Order): void {
  try {
    const next = [order, ...loadOrders()].slice(0, MAX_ORDERS);
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked storage must not stop the checkout.
  }
}

/**
 * Flips the matching order to `paid` when the signed payment webhook is
 * verified on the success route. The order stores the intent it was checked
 * out as, so the match is exact; the fallback to the newest pending order is
 * only there for records migrated from before the order model.
 */
export function markOrderPaid(paymentId: string): void {
  try {
    const orders = [...loadOrders()];
    const byPayment = orders.findIndex(
      (order) => order.paymentId === paymentId && order.status === "pending_payment",
    );
    const target =
      byPayment === -1
        ? orders.findIndex((order) => order.status === "pending_payment")
        : byPayment;
    const current = target === -1 ? undefined : orders[target];
    if (current === undefined) return;
    orders[target] = { ...current, status: "paid", paymentId };
    window.localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  } catch {
    // Storage failure must not hide a verified payment success page.
  }
}

/** The address to prefill the shipping form with, or null on a fresh device. */
export function mostRecentShippingAddress(): ShippingAddress | null {
  for (const order of loadOrders()) {
    if (order.shipping !== null) return order.shipping;
  }
  return null;
}

const TIME_FORMAT = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}
