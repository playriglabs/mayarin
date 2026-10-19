/**
 * Allowlist matcher tests (`apps/pay-proxy/src/allowlist.ts`).
 *
 * Pins the buyer path set the pay host forwards. A route that slips in here
 * exposes a `/v1/*` endpoint on the buyer origin; a route that drops out breaks
 * the checkout. Both directions are tested.
 */

import { describe, expect, test } from "bun:test";
import { allowed } from "../src/allowlist.ts";

describe("allowlist", () => {
  test("forwards the buyer pages and assets", () => {
    expect(allowed("GET", "/checkout/01LINKID")).toBe(true);
    expect(allowed("GET", "/checkout/pay/01INTENT")).toBe(true);
    expect(allowed("GET", "/checkout/qr?value=foo")).toBe(true);
    expect(allowed("GET", "/checkout/events/01INTENT")).toBe(true);
    expect(allowed("GET", "/checkout-ui/assets/index-abc.js")).toBe(true);
    expect(allowed("GET", "/checkout-ui/favicon.svg")).toBe(true);
    expect(allowed("GET", "/invoices/01INV/view")).toBe(true);
  });

  test("forwards the SPA's API calls", () => {
    expect(allowed("POST", "/v1/quotes")).toBe(true);
    expect(allowed("POST", "/v1/payment-links/01LINK/checkout")).toBe(true);
    expect(allowed("POST", "/v1/payment-intents/01INTENT/confirm")).toBe(true);
    expect(allowed("GET", "/v1/payments/01INTENT")).toBe(true);
    expect(allowed("POST", "/v1/invoices/01INV/checkout")).toBe(true);
  });

  test("method is case-insensitive", () => {
    expect(allowed("get", "/checkout/01LINKID")).toBe(true);
    expect(allowed("post", "/v1/quotes")).toBe(true);
  });

  test("rejects non-allowlisted /v1 routes — the API surface stays hidden", () => {
    expect(allowed("GET", "/v1/merchants")).toBe(false);
    expect(allowed("POST", "/v1/payment-links")).toBe(false); // list/create, not checkout
    expect(allowed("GET", "/v1/payment-intents/01INTENT")).toBe(false); // not /confirm
    expect(allowed("GET", "/v1/payment-links/01LINK/checkout")).toBe(false); // wrong method
    expect(allowed("POST", "/v1/payments/01INTENT")).toBe(false); // wrong method
    expect(allowed("GET", "/v1/invoices/01INV/checkout")).toBe(false); // wrong method
    expect(allowed("GET", "/v1/quotes")).toBe(false); // wrong method
  });

  test("rejects admin/operator/webhook surfaces", () => {
    expect(allowed("POST", "/v1/webhooks/mock")).toBe(false);
    expect(allowed("GET", "/health")).toBe(false);
    expect(allowed("GET", "/admin/payments")).toBe(false);
    expect(allowed("GET", "/")).toBe(false);
  });

  test("rejects path-segment tricks", () => {
    // `/checkoutfoo` is not `/checkout` or `/checkout/...`.
    expect(allowed("GET", "/checkoutfoo")).toBe(false);
    expect(allowed("GET", "/v1/paymentsfoo")).toBe(false);
    // `/invoices/:id/view` only — a bare invoice API path is not buyer-facing.
    expect(allowed("GET", "/invoices/01INV")).toBe(false);
    expect(allowed("POST", "/invoices/01INV/view")).toBe(false);
  });

  test("forwards the local-currency and protection calls the SPA makes", () => {
    expect(allowed("GET", "/v1/fiat-onramp/currencies")).toBe(true);
    expect(allowed("GET", "/v1/fiat-onramp/methods")).toBe(true);
    expect(allowed("POST", "/v1/fiat-onramp/rail")).toBe(true);
    expect(allowed("GET", "/v1/fiat-onramp/01INTENT/funding")).toBe(true);
    expect(allowed("POST", "/v1/fiat-onramp/01INTENT/order")).toBe(true);
    expect(allowed("GET", "/v1/payers/0xabc/protection")).toBe(true);
    expect(allowed("POST", "/v1/payments/01INTENT/escrow/dispute/messages")).toBe(true);
  });

  test("keeps the rest of those families closed, by method and by segment", () => {
    expect(allowed("POST", "/v1/fiat-onramp/currencies")).toBe(false); // wrong method
    expect(allowed("GET", "/v1/fiat-onramp/rail")).toBe(false);
    expect(allowed("GET", "/v1/fiat-onramp/01INTENT/order")).toBe(false);
    expect(allowed("POST", "/v1/fiat-onramp/01INTENT/funding")).toBe(false);
    expect(allowed("POST", "/v1/fiat-onramp/a/b/order")).toBe(false); // extra segment
    expect(allowed("POST", "/v1/fiat-onramp//order")).toBe(false); // empty id
    expect(allowed("GET", "/v1/fiat-onramp/01INTENT")).toBe(false);
    expect(allowed("GET", "/v1/payers/0xabc")).toBe(false);
    expect(allowed("GET", "/v1/payers/0xabc/protection/extra")).toBe(false);
    expect(allowed("GET", "/v1/payers")).toBe(false);
    expect(allowed("POST", "/v1/payments/01INTENT/refunds")).toBe(false);
    expect(allowed("POST", "/v1/payments/01INTENT/retry")).toBe(false);
    expect(allowed("POST", "/v1/payments/01INTENT/escrow/dispute")).toBe(false);
  });
});
