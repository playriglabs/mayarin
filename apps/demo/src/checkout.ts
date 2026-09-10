/**
 * Checks an order out through the thin server — the one checkout handler every
 * entry point funnels through. The shipping step calls it once the address
 * validates; the storefront's job ends at the hosted payment page.
 *
 * The order id goes with the request and comes back as the intent's
 * `merchantReference`, so the payment and the order this device remembers are
 * the same thing on both sides.
 */

export interface CheckoutLine {
  readonly productId: string;
  readonly quantity: number;
}

export interface MintedPayment {
  /** The Payment Intent id. What the success page polls and the order stores. */
  readonly id: string;
  /** The hosted payment page for that intent. */
  readonly url: string;
}

export async function checkoutOrder(
  orderId: string,
  lines: readonly CheckoutLine[],
): Promise<MintedPayment> {
  const response = await fetch("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orderId, lines }),
  });
  const body = (await response.json()) as { id?: string; url?: string; error?: string };
  if (!response.ok || body.url === undefined || body.id === undefined) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return { id: body.id, url: body.url };
}
