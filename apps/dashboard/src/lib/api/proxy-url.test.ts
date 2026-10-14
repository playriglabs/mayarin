import { describe, expect, test } from "bun:test";
import { apiProxyUrl } from "./proxy-url.ts";

const ORIGIN = "https://api.mayarin.example";

describe("apiProxyUrl", () => {
  test("keeps an ordinary path and query on the configured origin", () => {
    expect(apiProxyUrl("/v1/payments/pi_1", "?a=1", ORIGIN).toString()).toBe(
      "https://api.mayarin.example/v1/payments/pi_1?a=1",
    );
  });

  test.each([
    ["protocol-relative", "//evil.example/x"],
    ["backslash host", "/\\evil.example/x"],
    ["encoded slash", "/v1/%2f%2fevil.example"],
    ["encoded backslash", "/v1/%5cevil.example"],
    ["encoded dot", "/v1/%2e%2e/admin"],
    ["dot segments", "/v1/../admin"],
    ["no leading slash", "v1/payments"],
  ])("refuses a %s path", (_name, path) => {
    expect(() => apiProxyUrl(path, "", ORIGIN)).toThrow(RangeError);
  });
});
