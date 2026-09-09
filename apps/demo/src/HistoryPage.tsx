import { useEffect, useRef, useState } from "react";
import { formatIdrMinorUnits } from "./money.ts";
import { formatTime, loadOrders, type Order, type OrderStatus } from "./orders.ts";

const STATUS_BADGES: Record<OrderStatus, { readonly className: string; readonly label: string }> = {
  pending_payment: { className: "payment-status pending", label: "Pending payment" },
  paid: { className: "payment-status successful", label: "Paid" },
  failed: { className: "payment-status failed", label: "Failed" },
};

function OrderCard({
  order,
  highlighted,
}: {
  readonly order: Order;
  readonly highlighted: boolean;
}) {
  const badge = STATUS_BADGES[order.status];
  const createdAt = new Date(order.createdAt).toISOString();
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "center" });
  }, [highlighted]);

  return (
    <li
      ref={ref}
      id={`order-${order.id}`}
      className={highlighted ? "order-card highlight" : "order-card"}
    >
      <div className="order-head">
        <div>
          <p className="kicker">{highlighted ? "New order" : "Order"}</p>
          <h3 className="order-id">{order.id.slice(0, 8)}</h3>
        </div>
        <div className="order-head-side">
          <time dateTime={createdAt}>{formatTime(createdAt)}</time>
          <span className={badge.className}>{badge.label}</span>
        </div>
      </div>

      <ul className="order-items">
        {order.items.map((item) => (
          <li key={`${order.id}-${item.productId}-${item.name}`}>
            <span>
              {item.name} × {item.qty}
            </span>
            <span className="price">
              {formatIdrMinorUnits(BigInt(item.unitPrice) * BigInt(item.qty))}
            </span>
          </li>
        ))}
      </ul>

      <div className="order-total">
        <span>Total</span>
        <strong className="price">{formatIdrMinorUnits(BigInt(order.subtotal))}</strong>
      </div>

      {order.shipping !== null && (
        <p className="order-shipping">
          Ship to {order.shipping.recipientName}, {order.shipping.city}, {order.shipping.country}
        </p>
      )}

      {order.status === "pending_payment" && order.paymentUrl !== undefined && (
        <a className="btn-primary order-pay" href={order.paymentUrl}>
          Complete payment
        </a>
      )}
      {order.paymentId !== undefined && (
        <a
          className="payment-reference order-status-link"
          href={`/checkout/success/${encodeURIComponent(order.paymentId)}`}
        >
          View payment status
        </a>
      )}
    </li>
  );
}

/**
 * The purchase history route. One card per order — status belongs to the
 * whole order, never to a single line. The orders live only on this device.
 */
export function HistoryPage({ highlight }: { readonly highlight: string | null }) {
  const [orders] = useState<readonly Order[]>(loadOrders);

  return (
    <main className="page">
      <h2>Purchase history</h2>
      <p className="notice mt-2">
        Orders placed in this browser. This is not a customer account — the history lives only on
        this device.
      </p>

      {orders.length === 0 ? (
        <div className="state-panel mt-8">
          <p className="notice">No orders have been placed on this device yet.</p>
          <a className="see-all mt-4" href="/#koleksi">
            Browse the collection
          </a>
        </div>
      ) : (
        <>
          <ol className="order-list">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} highlighted={order.id === highlight} />
            ))}
          </ol>
          <p className="notice">
            An order is marked paid once the signed payment webhook is verified.
          </p>
        </>
      )}
    </main>
  );
}
