/**
 * Mints a `catalog` payment link through the thin server — the one checkout
 * handler every entry point funnels through. The shipping step calls it once
 * the address validates; the storefront's job ends at the link.
 */

export interface CheckoutLine {
  readonly productId: string;
  readonly quantity: number;
}

export interface MintedLink {
  readonly id: string;
  readonly url: string;
}

export async function mintCheckoutLink(lines: readonly CheckoutLine[]): Promise<MintedLink> {
  const response = await fetch("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lines }),
  });
  const body = (await response.json()) as { id?: string; url?: string; error?: string };
  if (!response.ok || body.url === undefined || body.id === undefined) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return { id: body.id, url: body.url };
}
