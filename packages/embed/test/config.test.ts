import { describe, expect, test } from "bun:test";
import { checkoutUrl, parseEmbedConfig } from "../src/config.ts";

const attributes = (overrides: Partial<Parameters<typeof parseEmbedConfig>[0]> = {}) => ({
  baseUrl: "https://api.mayarin.xyz",
  link: "plk_01J8Z3K4M5N6P7Q8R9S0T1U2V3",
  height: null,
  ...overrides,
});

describe("parseEmbedConfig", () => {
  test("accepts an origin and a link id", () => {
    const config = parseEmbedConfig(attributes());
    expect(config.baseUrl).toBe("https://api.mayarin.xyz");
    expect(config.linkId).toBe("plk_01J8Z3K4M5N6P7Q8R9S0T1U2V3");
  });

  test("requires base-url", () => {
    expect(() => parseEmbedConfig(attributes({ baseUrl: null }))).toThrow('"base-url"');
    expect(() => parseEmbedConfig(attributes({ baseUrl: "  " }))).toThrow('"base-url"');
  });

  test("requires link", () => {
    expect(() => parseEmbedConfig(attributes({ link: null }))).toThrow('"link"');
  });

  test("refuses a base-url that is not http(s)", () => {
    expect(() => parseEmbedConfig(attributes({ baseUrl: "javascript:alert(1)" }))).toThrow(
      "http(s)",
    );
    expect(() => parseEmbedConfig(attributes({ baseUrl: "not a url" }))).toThrow("http(s)");
  });

  test("strips trailing slashes and keeps a path prefix", () => {
    expect(parseEmbedConfig(attributes({ baseUrl: "https://api.test/" })).baseUrl).toBe(
      "https://api.test",
    );
    expect(
      parseEmbedConfig(attributes({ baseUrl: "https://pay.example.com/mayarin/" })).baseUrl,
    ).toBe("https://pay.example.com/mayarin");
  });

  test("defaults the height, appends px to a bare number, passes a CSS length through", () => {
    expect(parseEmbedConfig(attributes()).height).toBe("640px");
    expect(parseEmbedConfig(attributes({ height: "720" })).height).toBe("720px");
    expect(parseEmbedConfig(attributes({ height: "80vh" })).height).toBe("80vh");
  });
});

describe("checkoutUrl", () => {
  test("targets the unversioned buyer page, not /v1 (#138)", () => {
    const url = checkoutUrl(parseEmbedConfig(attributes()));
    expect(url).toBe("https://api.mayarin.xyz/checkout/plk_01J8Z3K4M5N6P7Q8R9S0T1U2V3");
  });

  test("encodes the link id", () => {
    const url = checkoutUrl(parseEmbedConfig(attributes({ link: "a/b?c" })));
    expect(url).toBe("https://api.mayarin.xyz/checkout/a%2Fb%3Fc");
  });
});
