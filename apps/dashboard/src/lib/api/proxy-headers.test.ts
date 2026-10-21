import { describe, expect, test } from "bun:test";
import { apiProxyHeaders, apiProxyResponseHeaders } from "./proxy-headers";

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

  test("forwards the step-up code that fund-moving routes demand", () => {
    const headers = apiProxyHeaders(new Headers({ "x-mfa-code": "123456" }));
    expect(headers.get("x-mfa-code")).toBe("123456");
  });

  test("drops every request header that is not on the allowlist", () => {
    const headers = apiProxyHeaders(
      new Headers({
        cookie: "mayarin_session=abc",
        "x-csrf-token": "t",
        "x-forwarded-for": "198.51.100.1",
        "x-forwarded-host": "evil.example",
        "cf-ray": "abc",
        origin: "https://evil.example",
      }),
    );
    expect(headers.get("cookie")).toBe("mayarin_session=abc");
    expect(headers.get("x-csrf-token")).toBe("t");
    expect(headers.has("x-forwarded-for")).toBe(false);
    expect(headers.has("x-forwarded-host")).toBe(false);
    expect(headers.has("cf-ray")).toBe(false);
    expect(headers.has("origin")).toBe(false);
  });
});

describe("apiProxyResponseHeaders", () => {
  test("keeps every repeated set-cookie and drops internals", () => {
    const upstream = new Headers({ "content-type": "application/json", "x-railway-edge": "a" });
    upstream.append("set-cookie", "a=1; Path=/");
    upstream.append("set-cookie", "b=2; Path=/");
    const headers = apiProxyResponseHeaders(upstream);
    expect(headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.has("x-railway-edge")).toBe(false);
  });

  test("adds the origin proof after the allowlist, so a visitor's own copy is dropped", () => {
    const headers = apiProxyHeaders(
      new Headers({ cookie: "mayarin_session=abc", "x-origin-secret": "visitor-guess" }),
      { "x-origin-secret": "edge-secret" },
    );
    expect(headers.get("x-origin-secret")).toBe("edge-secret");
    expect(
      apiProxyHeaders(new Headers({ "x-origin-secret": "visitor-guess" })).get("x-origin-secret"),
    ).toBeNull();
  });
});
