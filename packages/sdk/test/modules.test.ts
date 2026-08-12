import { describe, expect, test } from "bun:test";
import { createMayarin } from "../src/index.ts";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: string | undefined;
}

function clientReturning(responseBody: unknown) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return {
    calls,
    client: createMayarin({ baseUrl: "https://api.test", secretKey: "sk_test", fetch }),
  };
}

describe("payment module", () => {
  test("creates a typed payment intent through the shared transport", async () => {
    const paymentIntent = { id: "pi_1" };
    const { calls, client } = clientReturning({ paymentIntent });
    const result = await client.payment.createIntent({
      merchant: { id: "m_1", name: "Toko", city: "Jakarta", countryCode: "ID" },
      amount: { amount: "50000.00", asset: "IDR" },
    });
    expect(result.id).toBe(paymentIntent.id);
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/payment-intents", method: "POST" });
  });

  test("encodes an identifier before placing it in a path", async () => {
    const { calls, client } = clientReturning({ paymentIntent: { id: "a/b" } });
    await client.payment.getIntent("a/b");
    expect(calls[0]?.url).toBe("https://api.test/v1/payment-intents/a%2Fb");
  });
});

describe("merchant commerce module", () => {
  test("creates a fixed IDR payment link", async () => {
    const paymentLink = { id: "link_1", url: "https://pay.test/checkout/link_1" };
    const { calls, client } = clientReturning({ paymentLink });
    const result = await client.commerce.paymentLinks.create({
      kind: "fixed",
      merchant: { id: "m_1", name: "Toko", city: "Jakarta", countryCode: "ID" },
      amount: { amount: "50000.00", asset: "IDR" },
    });
    expect(result.url).toBe("https://pay.test/checkout/link_1");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      amount: { amount: "50000.00", asset: "IDR" },
    });
  });

  test("lists the authenticated merchant's invoices without requiring an id", async () => {
    const { calls, client } = clientReturning({ invoices: [] });
    await client.commerce.invoices.list();
    expect(calls[0]?.url).toBe("https://api.test/v1/invoices");
  });

  test("checks out a cart through /carts/checkout (#113)", async () => {
    const paymentIntent = { id: "pi_1", status: "CREATED" };
    const { calls, client } = clientReturning({ paymentIntent });
    const result = await client.commerce.carts.checkout({
      merchant: { id: "m_1", name: "Toko", city: "Jakarta", countryCode: "ID" },
      currency: "IDR",
      lines: [{ name: "Roti", unitPrice: { amount: "12000.00", asset: "IDR" }, quantity: 1 }],
    });
    expect(result.id).toBe("pi_1");
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/carts/checkout", method: "POST" });
  });
});
