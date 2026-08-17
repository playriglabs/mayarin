/**
 * The checkout UI shell seam (#151): bootstrap injection and asset serving.
 *
 * The page routes' own behaviour is covered where the pages are tested
 * (`commerce.test.ts`, `invoices.test.ts`); this file pins the seam itself.
 */

import { describe, expect, test } from "bun:test";
import { bootstrapScript, requestOrigin } from "../src/services/checkout-shell.ts";
import { createApiHarness } from "./harness.ts";

const merchant = { id: "mrc_1", name: "Warung Kopi", city: "Jakarta", countryCode: "ID" };

describe("bootstrap script", () => {
  test("keeps a script-closing value inert inside the JSON", () => {
    const script = bootstrapScript({ name: "</script><script>alert(1)</script>" });
    expect(script).not.toContain("</script><script>");
    // The escape is lossless: the parsed value is the original string.
    const json = script.replace("<script>window.__BOOTSTRAP__ = ", "").replace("</script>", "");
    expect(JSON.parse(json).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("requestOrigin", () => {
  const fallback = "http://localhost:3000";
  const headers =
    (entries: Record<string, string>) =>
    (name: string): string | undefined =>
      entries[name.toLowerCase()];

  test("uses the forwarded host so a proxied buyer origin is same-origin", () => {
    expect(
      requestOrigin(headers({ "x-forwarded-host": "pay-testnet.mayarin.xyz" }), fallback),
    ).toBe("https://pay-testnet.mayarin.xyz");
  });

  test("respects the forwarded proto", () => {
    expect(
      requestOrigin(
        headers({ "x-forwarded-host": "pay-testnet.mayarin.xyz", "x-forwarded-proto": "http" }),
        fallback,
      ),
    ).toBe("http://pay-testnet.mayarin.xyz");
  });

  test("falls back to publicBaseUrl when no forwarded host is present", () => {
    expect(requestOrigin(headers({}), fallback)).toBe(fallback);
  });

  test("ignores an empty forwarded host", () => {
    expect(requestOrigin(headers({ "x-forwarded-host": "" }), fallback)).toBe(fallback);
  });
});

describe("GET /checkout-ui/assets", () => {
  test("serves a hashed bundle as immutable", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/checkout-ui/assets/index-TESTHASH.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/javascript");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  test("a missing asset is a 404, not a directory listing", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/checkout-ui/assets/nope.js");
    expect(response.status).toBe(404);
  });

  test("a dot-segment name cannot walk out of the assets directory", async () => {
    const harness = createApiHarness();
    // `..%2f..%2findex.html` decodes to a traversal; the route refuses it by
    // name before any path is built.
    const response = await harness.app.request("/checkout-ui/assets/..%2f..%2findex.html");
    expect(response.status).toBe(404);
  });
});

describe("GET /checkout/:id/og.png", () => {
  test("renders a PNG for a fixed link", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    const id = created.body.paymentLink.id;

    const response = await harness.app.request(`/checkout/${id}/og.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A.
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
  });

  test("a missing link answers 200 with the generic card, never 404/500", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/checkout/plg_does_not_exist/og.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes[0]).toBe(0x89);
  });
});

describe("GET /invoices/:id/og.png", () => {
  test("a missing invoice answers 200 with the generic card", async () => {
    const harness = createApiHarness();
    const response = await harness.app.request("/invoices/inv_does_not_exist/og.png");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });
});

describe("page shells carry per-document OG meta", () => {
  test("the link page injects an og:image pointing at its own og.png", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    const id = created.body.paymentLink.id;

    const response = await harness.app.request(`/checkout/${id}`);
    const html = await response.text();
    expect(html).toContain(
      `<meta property="og:image" content="http://localhost:3000/checkout/${id}/og.png" />`,
    );
    expect(html).toContain(`<meta name="twitter:card" content="summary_large_image" />`);
  });

  test("the pay page falls back to the generic landing image", async () => {
    const harness = createApiHarness();
    const created = await harness.request("POST", "/v1/payment-links", {
      body: { kind: "fixed", merchant, amount: { amount: "50000.00", asset: "IDR" } },
    });
    const link = created.body.paymentLink;
    const minted = await harness.request("POST", `/v1/payment-links/${link.id}/checkout`, {
      body: {},
    });
    const intentId = minted.body.paymentIntent.id;

    const response = await harness.app.request(`/checkout/pay/${intentId}`);
    const html = await response.text();
    expect(html).toContain(
      `<meta property="og:image" content="https://mayarin.xyz/og-image.png" />`,
    );
  });
});
