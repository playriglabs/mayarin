import { afterEach, describe, expect, test } from "bun:test";
import worker from "../src/index.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function through(
  env: { ORIGIN: string; ORIGIN_AUTH_SECRET?: string },
  headers: HeadersInit = {},
) {
  let seen: Headers | undefined;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    seen = new Headers(init.headers as Record<string, string>);
    return new Response("ok");
  }) as typeof fetch;
  await worker.fetch(new Request("https://pay.example/checkout/pay/pi_1", { headers }), env);
  return seen;
}

describe("origin authentication on the pay host (SEC-13)", () => {
  test("every forwarded request carries the secret the origin will require", async () => {
    const seen = await through({
      ORIGIN: "https://origin.example",
      ORIGIN_AUTH_SECRET: "edge-secret",
    });
    expect(seen?.get("x-origin-secret")).toBe("edge-secret");
  });

  test("a visitor's own copy of the header is replaced, or dropped when none is configured", async () => {
    const guess = { "x-origin-secret": "visitor-guess" };
    expect(
      (
        await through(
          { ORIGIN: "https://origin.example", ORIGIN_AUTH_SECRET: "edge-secret" },
          guess,
        )
      )?.get("x-origin-secret"),
    ).toBe("edge-secret");
    expect(
      (await through({ ORIGIN: "https://origin.example" }, guess))?.get("x-origin-secret"),
    ).toBeNull();
  });
});
