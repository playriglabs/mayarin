import { describe, expect, test } from "bun:test";
import { apiProxyHeaders } from "./proxy-headers";

describe("apiProxyHeaders", () => {
  test("forwards Cloudflare's visitor IP instead of a supplied x-real-ip", () => {
    const headers = apiProxyHeaders(
      new Headers({
        "cf-connecting-ip": "203.0.113.10",
        "content-length": "123",
        host: "dashboard-testnet.mayarin.xyz",
        "x-real-ip": "192.0.2.30",
      }),
    );

    expect(headers.get("x-real-ip")).toBe("203.0.113.10");
    expect(headers.has("host")).toBe(false);
    expect(headers.has("content-length")).toBe(false);
  });

  test("does not forward an untrusted x-real-ip without Cloudflare identity", () => {
    const headers = apiProxyHeaders(new Headers({ "x-real-ip": "192.0.2.30" }));
    expect(headers.has("x-real-ip")).toBe(false);
  });
});
