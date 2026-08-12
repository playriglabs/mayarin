import { describe, expect, test } from "bun:test";
import {
  type CartEmbedConfig,
  cartCheckoutPlan,
  checkoutUrl,
  type EmbedAttributes,
  type LinkEmbedConfig,
  parseEmbedConfig,
  payUrl,
} from "../src/config.ts";

const attributes = (overrides: Partial<EmbedAttributes> = {}): EmbedAttributes => ({
  baseUrl: "https://api.mayarin.xyz",
  link: "plk_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
  cart: null,
  publishableKey: null,
  height: null,
  ...overrides,
});

const CART = JSON.stringify({
  merchant: { id: "m_1", name: "Toko", city: "Jakarta", countryCode: "ID" },
  currency: "IDR",
  lines: [{ name: "Roti", unitPrice: { amount: "12000.00", asset: "IDR" }, quantity: 1 }],
  payment: { asset: "USDC", chain: "base-sepolia" },
});

const cartAttributes = (overrides: Partial<EmbedAttributes> = {}): EmbedAttributes =>
  attributes({ link: null, cart: CART, publishableKey: "pk_test", ...overrides });

function asLink(attrs: EmbedAttributes): LinkEmbedConfig {
  const config = parseEmbedConfig(attrs);
  if (config.mode !== "link") throw new Error("expected link mode");
  return config;
}

function asCart(attrs: EmbedAttributes): CartEmbedConfig {
  const config = parseEmbedConfig(attrs);
  if (config.mode !== "cart") throw new Error("expected cart mode");
  return config;
}

describe("parseEmbedConfig", () => {
  test("accepts an origin and a link id", () => {
    const config = asLink(attributes());
    expect(config.baseUrl).toBe("https://api.mayarin.xyz");
    expect(config.linkId).toBe("plk_01J8Z3K4M5N6P7Q8R9S0T1U2V3");
  });

  test("requires base-url", () => {
    expect(() => parseEmbedConfig(attributes({ baseUrl: null }))).toThrow('"base-url"');
    expect(() => parseEmbedConfig(attributes({ baseUrl: "  " }))).toThrow('"base-url"');
  });

  test("requires link or cart, and refuses both", () => {
    expect(() => parseEmbedConfig(attributes({ link: null }))).toThrow('"link"');
    expect(() => parseEmbedConfig(cartAttributes({ link: "plk_1" }))).toThrow("not both");
  });

  test("refuses a base-url that is not http(s)", () => {
    expect(() => parseEmbedConfig(attributes({ baseUrl: "javascript:alert(1)" }))).toThrow(
      "http(s)",
    );
    expect(() => parseEmbedConfig(attributes({ baseUrl: "not a url" }))).toThrow("http(s)");
  });

  test("strips trailing slashes and keeps a path prefix", () => {
    expect(asLink(attributes({ baseUrl: "https://api.test/" })).baseUrl).toBe("https://api.test");
    expect(asLink(attributes({ baseUrl: "https://pay.example.com/mayarin/" })).baseUrl).toBe(
      "https://pay.example.com/mayarin",
    );
  });

  test("defaults the height, appends px to a bare number, passes a CSS length through", () => {
    expect(asLink(attributes()).height).toBe("640px");
    expect(asLink(attributes({ height: "720" })).height).toBe("720px");
    expect(asLink(attributes({ height: "80vh" })).height).toBe("80vh");
  });
});

describe("cart mode (#113)", () => {
  test("parses a cart with a publishable key", () => {
    const config = asCart(cartAttributes());
    expect(config.publishableKey).toBe("pk_test");
    expect(config.body["currency"]).toBe("IDR");
  });

  test("requires a publishable key, and refuses a secret", () => {
    expect(() => parseEmbedConfig(cartAttributes({ publishableKey: null }))).toThrow(
      '"publishable-key"',
    );
    expect(() => parseEmbedConfig(cartAttributes({ publishableKey: "sk_leaked" }))).toThrow(
      "never a secret",
    );
  });

  test("refuses malformed cart JSON and a cart without a payment rail", () => {
    expect(() => parseEmbedConfig(cartAttributes({ cart: "{oops" }))).toThrow("not valid JSON");
    expect(() => parseEmbedConfig(cartAttributes({ cart: "[1]" }))).toThrow("JSON object");
    expect(() => parseEmbedConfig(cartAttributes({ cart: '{"currency":"IDR"}' }))).toThrow(
      '"payment" rail',
    );
  });

  test("the plan mints and confirms under /v1 with the pk as bearer", () => {
    const plan = cartCheckoutPlan(asCart(cartAttributes()));
    expect(plan.mintUrl).toBe("https://api.mayarin.xyz/v1/carts/checkout");
    expect(plan.confirmUrl("pi_1")).toBe("https://api.mayarin.xyz/v1/payment-intents/pi_1/confirm");
    expect(plan.headers["authorization"]).toBe("Bearer pk_test");
  });

  test("pins deposit-match unless the cart chose a path", () => {
    expect(cartCheckoutPlan(asCart(cartAttributes())).body["executionPath"]).toBe("deposit-match");
    const explicit = cartAttributes({
      cart: JSON.stringify({ ...JSON.parse(CART), executionPath: "on-chain-contract" }),
    });
    expect(cartCheckoutPlan(asCart(explicit)).body["executionPath"]).toBe("on-chain-contract");
  });

  test("the pay page URL is the unversioned buyer page", () => {
    expect(payUrl(asCart(cartAttributes()), "pi_1")).toBe(
      "https://api.mayarin.xyz/checkout/pay/pi_1",
    );
  });
});

describe("checkoutUrl", () => {
  test("targets the unversioned buyer page, not /v1 (#138)", () => {
    const url = checkoutUrl(asLink(attributes()));
    expect(url).toBe("https://api.mayarin.xyz/checkout/plk_01J8Z3K4M5N6P7Q8R9S0T1U2V3");
  });

  test("encodes the link id", () => {
    const url = checkoutUrl(asLink(attributes({ link: "a/b?c" })));
    expect(url).toBe("https://api.mayarin.xyz/checkout/a%2Fb%3Fc");
  });
});
