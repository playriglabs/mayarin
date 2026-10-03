/**
 * Turning checkout options into the hosted checkout URL — no React here.
 *
 * Two ways to get a URL, and the difference is who decides the price:
 *
 * - **Server** (`checkout`): the merchant's own backend mints the intent with
 *   its secret key and hands back the URL. The price never leaves the server,
 *   so nobody can edit it. Use this for anything you sell.
 * - **Browser** (`publishableKey` + `amount`): the browser mints the intent
 *   itself with a publishable key. No backend needed, but the amount is
 *   whatever the browser sends — a buyer with devtools can change it. Fine for
 *   donations, tips and pay-what-you-want; for a sale, check the paid amount
 *   against your order (by `merchantReference`) in the webhook before
 *   shipping anything.
 */

import { createMayarinBrowser, type MayarinBrowserClient } from "@mayarin/sdk/browser";

/** The `POST /v1/carts/checkout` body, as the SDK types it. */
export type CartBody = Parameters<MayarinBrowserClient["commerce"]["carts"]["checkout"]>[0];

/** What a server-mode `checkout` resolves to: the URL, or an object carrying it. */
export type CheckoutUrl = string | { readonly url: string };

export interface ServerCheckout {
  /** Calls your backend, which mints the intent and returns its checkout URL. */
  readonly checkout: () => Promise<CheckoutUrl>;
  readonly publishableKey?: never;
}

export interface BrowserCheckout {
  readonly checkout?: never;
  /** A `pk_...` key from the dashboard. It names the merchant; no merchant id is needed. */
  readonly publishableKey: string;
  /** Origin of the payment API, e.g. `https://api-testnet.mayarin.xyz`. */
  readonly baseUrl: string;
  /** Decimal amount per unit in `currency`, e.g. `"150000.00"`. Never a float. */
  readonly amount: string;
  /** The currency the merchant prices in, e.g. `"IDR"`. */
  readonly currency: CartBody["currency"];
  /** The line the buyer sees on the checkout page. Defaults to `"Payment"`. */
  readonly name?: string;
  readonly quantity?: number;
  /** Your order id. Comes back on the payment and in every webhook. */
  readonly merchantReference?: string;
  /** Where the buyer lands after paying: `{successUrl}/{paymentIntentId}`. HTTPS or localhost. */
  readonly successUrl?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export type CheckoutOptions = ServerCheckout | BrowserCheckout;

/** The `POST /v1/carts/checkout` body for a browser-mode checkout: one ad-hoc line. */
export function cartBody(options: BrowserCheckout): CartBody {
  const metadata: Record<string, string> = {
    ...options.metadata,
    ...(options.successUrl === undefined ? {} : { checkoutSuccessBaseUrl: options.successUrl }),
  };
  return {
    currency: options.currency,
    lines: [
      {
        name: options.name ?? "Payment",
        unitPrice: { amount: options.amount, asset: options.currency },
        quantity: options.quantity ?? 1,
      },
    ],
    ...(options.merchantReference === undefined
      ? {}
      : { merchantReference: options.merchantReference }),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

export async function resolveCheckoutUrl(
  options: CheckoutOptions,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<string> {
  if (options.checkout !== undefined) {
    const result = await options.checkout();
    return typeof result === "string" ? result : result.url;
  }
  const client = createMayarinBrowser({
    baseUrl: options.baseUrl,
    publishableKey: options.publishableKey,
    fetch: fetcher,
  });
  return (await client.commerce.carts.checkout(cartBody(options))).url;
}
