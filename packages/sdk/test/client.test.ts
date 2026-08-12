import { describe, expect, test } from "bun:test";
import { createMayarinBrowser, type MayarinBrowserConfig } from "../src/browser.ts";
import { createMayarin } from "../src/index.ts";
import { PRESETS } from "../src/presets.ts";

function capturingFetch(): { headers: Headers[]; fetch: typeof fetch } {
  const headers: Headers[] = [];
  const impl = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    headers.push(new Headers(init?.headers));
    return new Response("{}", { status: 200 });
  };
  return { headers, fetch: impl as typeof fetch };
}

describe("entry points", () => {
  test("the server client sends its secret as a bearer header", async () => {
    const { headers, fetch } = capturingFetch();
    const client = createMayarin({ baseUrl: "https://api.test", secretKey: "sk_1", fetch });
    await client.transport.get("/payment-intents/pi_1");
    expect(headers[0]?.get("Authorization")).toBe("Bearer sk_1");
  });

  test("the browser client never sends an Authorization header", async () => {
    const { headers, fetch } = capturingFetch();
    const client = createMayarinBrowser({ baseUrl: "https://api.test", fetch });
    await client.transport.get("/quotes");
    expect(headers[0]?.get("Authorization")).toBeNull();
  });

  test("the browser config has no field for a secret", () => {
    // Compile-time property: a secret in browser config is a type error.
    // @ts-expect-error -- MayarinBrowserConfig rejects secretKey
    const config: MayarinBrowserConfig = { baseUrl: "https://api.test", secretKey: "sk_1" };
    expect(config.baseUrl).toBe("https://api.test");
  });

  test("a publishable key goes out as the bearer header (#113)", async () => {
    const { headers, fetch } = capturingFetch();
    const client = createMayarinBrowser({
      baseUrl: "https://api.test",
      publishableKey: "pk_1",
      fetch,
    });
    await client.commerce.products.list();
    expect(headers[0]?.get("Authorization")).toBe("Bearer pk_1");
  });

  test("the browser commerce surface has no write methods", () => {
    const client = createMayarinBrowser({ baseUrl: "https://api.test", publishableKey: "pk_1" });
    // Compile-time property: the publishable subset carries no create/update.
    // @ts-expect-error -- PublishableCommerceModule has no products.create
    expect(client.commerce.products.create).toBeUndefined();
  });
});

describe("presets", () => {
  test("the default preset is merchant", () => {
    const client = createMayarin({ baseUrl: "https://api.test", secretKey: "sk_1" });
    expect(client.preset).toEqual(PRESETS.merchant);
  });

  test("merchant defaults to catalog checkout and fixed amounts", () => {
    const client = createMayarinBrowser({ baseUrl: "https://api.test", preset: "merchant" });
    expect(client.preset.openAmountLinks).toBe(false);
    expect(client.preset.checkout).toBe("catalog");
  });
});
