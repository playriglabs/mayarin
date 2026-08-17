/**
 * The checkout UI shell seam (#151): bootstrap injection and asset serving.
 *
 * The page routes' own behaviour is covered where the pages are tested
 * (`commerce.test.ts`, `invoices.test.ts`); this file pins the seam itself.
 */

import { describe, expect, test } from "bun:test";
import { bootstrapScript, requestOrigin } from "../src/services/checkout-shell.ts";
import { createApiHarness } from "./harness.ts";

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
