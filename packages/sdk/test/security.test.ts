import { afterEach, describe, expect, test } from "bun:test";
import { createMayarinBrowser } from "../src/browser.ts";
import { createMayarin } from "../src/index.ts";
import { createTransport } from "../src/transport.ts";
import { verifyWebhook } from "../src/webhooks.ts";
import { createX402Gate } from "../src/x402.ts";

describe("key placement", () => {
  test("the server client refuses anything but a secret key", () => {
    expect(() => createMayarin({ baseUrl: "https://api.test", secretKey: "pk_1" })).toThrow("sk_");
  });

  test("the browser client refuses a secret key", () => {
    expect(() =>
      createMayarinBrowser({ baseUrl: "https://api.test", publishableKey: "sk_live_1" }),
    ).toThrow("never a secret key");
  });

  describe("in a browser", () => {
    const globals = globalThis as Record<string, unknown>;
    afterEach(() => {
      delete globals.window;
      delete globals.document;
    });

    test("the server client refuses to run at all", () => {
      globals.window = {};
      globals.document = {};
      expect(() => createMayarin({ baseUrl: "https://api.test", secretKey: "sk_1" })).toThrow(
        "server only",
      );
    });
  });
});

describe("base url", () => {
  test("plain http to a remote host is refused — the key would travel in clear", () => {
    expect(() => createTransport({ baseUrl: "http://api.mayarin.xyz" })).toThrow("https");
    expect(() => createX402Gate({ baseUrl: "http://api.mayarin.xyz", resourceId: "r" })).toThrow(
      "https",
    );
  });

  test("plain http to a loopback host is allowed for local development", () => {
    for (const baseUrl of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"]) {
      expect(() => createTransport({ baseUrl })).not.toThrow();
    }
  });

  test("a value that is not a URL is refused", () => {
    expect(() => createTransport({ baseUrl: "api.mayarin.xyz" })).toThrow("not a URL");
  });
});

describe("redirects", () => {
  test("a request never follows one, so the bearer key cannot be forwarded", async () => {
    let redirect: RequestRedirect | undefined;
    const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      redirect = init?.redirect;
      return new Response("{}");
    }) as typeof globalThis.fetch;
    await createTransport({ baseUrl: "https://api.test", secretKey: "sk_1", fetch }).get("/x");
    expect(redirect).toBe("error");
  });
});

describe("webhooks", () => {
  test("an empty secret is refused instead of verifying against it", async () => {
    await expect(
      verifyWebhook({ payload: "{}", signature: "t=1,v1=00", secret: "" }),
    ).rejects.toThrow("empty");
  });
});
