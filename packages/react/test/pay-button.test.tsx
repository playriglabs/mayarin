import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { cartBody, PayButton, resolveCheckoutUrl } from "../src/index.ts";

const browser = {
  publishableKey: "pk_test",
  baseUrl: "https://api.example",
  amount: "150000.00",
  currency: "IDR",
} as const;

describe("cartBody", () => {
  test("is one ad-hoc line with no merchant — the key names the merchant", () => {
    expect(cartBody(browser)).toEqual({
      currency: "IDR",
      lines: [{ name: "Payment", unitPrice: { amount: "150000.00", asset: "IDR" }, quantity: 1 }],
    });
  });

  test("carries the order reference and the success URL", () => {
    const body = cartBody({
      ...browser,
      name: "Order #123",
      quantity: 2,
      merchantReference: "order_123",
      successUrl: "https://shop.example/thanks",
      metadata: { channel: "web" },
    });
    expect(body.lines[0]).toEqual({
      name: "Order #123",
      unitPrice: { amount: "150000.00", asset: "IDR" },
      quantity: 2,
    });
    expect(body.merchantReference).toBe("order_123");
    expect(body.metadata).toEqual({
      channel: "web",
      checkoutSuccessBaseUrl: "https://shop.example/thanks",
    });
  });
});

describe("resolveCheckoutUrl", () => {
  test("server mode takes a bare URL or an object carrying one", async () => {
    expect(await resolveCheckoutUrl({ checkout: async () => "https://pay/1" })).toBe(
      "https://pay/1",
    );
    expect(await resolveCheckoutUrl({ checkout: async () => ({ url: "https://pay/2" }) })).toBe(
      "https://pay/2",
    );
  });

  test("browser mode posts the cart with the publishable key", async () => {
    const seen: { url: string; auth: string | null; body: unknown }[] = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      seen.push({
        url: request.url,
        auth: request.headers.get("authorization"),
        body: await request.json(),
      });
      return Response.json(
        { paymentIntent: { id: "pi_1" }, url: "https://pay.example/checkout/pay/pi_1" },
        { status: 201 },
      );
    }) as typeof fetch;

    const url = await resolveCheckoutUrl(browser, fetcher);
    expect(url).toBe("https://pay.example/checkout/pay/pi_1");
    expect(seen[0]?.url).toBe("https://api.example/v1/carts/checkout");
    expect(seen[0]?.auth).toBe("Bearer pk_test");
    expect(seen[0]?.body).toEqual(cartBody(browser));
  });
});

describe("PayButton", () => {
  test("renders any children and keeps button attributes", () => {
    const html = renderToStaticMarkup(
      <PayButton {...browser} className="btn" id="pay">
        <span>Continue</span>
      </PayButton>,
    );
    expect(html).toContain('class="btn"');
    expect(html).toContain('id="pay"');
    expect(html).toContain('type="button"');
    expect(html).toContain("<span>Continue</span>");
  });

  test("leaks no checkout prop onto the DOM", () => {
    const html = renderToStaticMarkup(<PayButton {...browser} merchantReference="order_1" />);
    expect(html).toContain("Pay with crypto");
    expect(html).not.toContain("pk_test");
    expect(html).not.toContain("order_1");
  });

  test("a render function sees the busy state", () => {
    const html = renderToStaticMarkup(
      <PayButton checkout={async () => "https://pay/1"}>
        {({ loading }) => (loading ? "Redirecting…" : "Pay")}
      </PayButton>,
    );
    expect(html).toContain(">Pay</button>");
  });
});
