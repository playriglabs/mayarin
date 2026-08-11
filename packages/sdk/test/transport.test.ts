import { describe, expect, test } from "bun:test";
import { isMayarinApiError, type MayarinApiError } from "../src/errors.ts";
import { createTransport, type TransportConfig } from "../src/transport.ts";
import { MAYARIN_VERSION } from "../src/version.ts";

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
}

function fakeFetch(response: () => Response): { calls: Captured[]; fetch: typeof fetch } {
  const calls: Captured[] = [];
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    return response();
  };
  return { calls, fetch: impl as typeof fetch };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function transport(overrides: Partial<TransportConfig>, response: () => Response) {
  const { calls, fetch } = fakeFetch(response);
  const t = createTransport({ baseUrl: "https://api.test", fetch, ...overrides });
  return { t, calls };
}

describe("headers", () => {
  test("every request pins Mayarin-Version", async () => {
    const { t, calls } = transport({}, () => json({ ok: true }));
    await t.get("/health");
    expect(calls[0]?.headers.get("Mayarin-Version")).toBe(MAYARIN_VERSION);
  });

  test("a secret key becomes a bearer header", async () => {
    const { t, calls } = transport({ secretKey: "sk_test_123" }, () => json({}));
    await t.get("/payment-intents/pi_1");
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer sk_test_123");
  });

  test("no secret key means no Authorization header", async () => {
    const { t, calls } = transport({}, () => json({}));
    await t.get("/quotes");
    expect(calls[0]?.headers.get("Authorization")).toBeNull();
  });
});

describe("idempotency keys", () => {
  test("a write generates a key when the caller supplies none", async () => {
    const { t, calls } = transport({ generateIdempotencyKey: () => "gen-1" }, () => json({}));
    await t.post("/payment-intents", { amount: "5000" });
    expect(calls[0]?.headers.get("Idempotency-Key")).toBe("gen-1");
  });

  test("a caller-supplied key wins", async () => {
    const { t, calls } = transport({ generateIdempotencyKey: () => "gen-1" }, () => json({}));
    await t.post("/payment-intents", {}, { idempotencyKey: "mine" });
    expect(calls[0]?.headers.get("Idempotency-Key")).toBe("mine");
  });

  test("a read sends no key", async () => {
    const { t, calls } = transport({}, () => json({}));
    await t.get("/payment-intents/pi_1");
    expect(calls[0]?.headers.get("Idempotency-Key")).toBeNull();
  });

  test("a patch is a write and gets a key", async () => {
    const { t, calls } = transport({ generateIdempotencyKey: () => "gen-2" }, () => json({}));
    await t.patch("/catalog/products/prd_1", { name: "Kopi" });
    expect(calls[0]?.headers.get("Idempotency-Key")).toBe("gen-2");
  });
});

describe("requests", () => {
  test("a body is JSON with the content type set", async () => {
    const { t, calls } = transport({}, () => json({}));
    await t.post("/carts", { items: [] });
    expect(calls[0]?.headers.get("Content-Type")).toBe("application/json");
    expect(calls[0]?.body).toBe(JSON.stringify({ items: [] }));
  });

  test("query params encode onto the url and skip undefined", async () => {
    const { t, calls } = transport({}, () => json({}));
    await t.get("/quotes", { query: { asset: "USDC", amount: 5000, cursor: undefined } });
    expect(calls[0]?.url).toBe("https://api.test/v1/quotes?asset=USDC&amount=5000");
  });

  test("a trailing slash on the base url does not double", async () => {
    const { calls, fetch } = fakeFetch(() => json({}));
    const t = createTransport({ baseUrl: "https://api.test/", fetch });
    await t.get("/health");
    expect(calls[0]?.url).toBe("https://api.test/v1/health");
  });

  test("every path targets the /v1 base (#138)", async () => {
    const { t, calls } = transport({}, () => json({}));
    await t.get("/payment-intents/pi_1");
    await t.post("/payment-links", {});
    expect(calls[0]?.url).toBe("https://api.test/v1/payment-intents/pi_1");
    expect(calls[1]?.url).toBe("https://api.test/v1/payment-links");
  });

  test("a 2xx returns the parsed body", async () => {
    const { t } = transport({}, () => json({ paymentIntent: { id: "pi_1" } }));
    const result = await t.get<{ paymentIntent: { id: string } }>("/payment-intents/pi_1");
    expect(result.paymentIntent.id).toBe("pi_1");
  });
});

describe("errors", () => {
  test("an API error body maps onto code, status and details", async () => {
    const body = {
      error: {
        code: "NOT_FOUND",
        message: "No such intent",
        retryable: false,
        details: { id: "pi_x" },
      },
    };
    const { t } = transport({}, () => json(body, 404));
    const error = await t.get("/payment-intents/pi_x").catch((e: unknown) => e);
    expect(isMayarinApiError(error)).toBe(true);
    const apiError = error as MayarinApiError;
    expect(apiError.code).toBe("NOT_FOUND");
    expect(apiError.status).toBe(404);
    expect(apiError.details).toEqual({ id: "pi_x" });
    expect(apiError.retryable).toBe(false);
  });

  test("a concurrency conflict is retryable", async () => {
    const body = {
      error: { code: "CONCURRENCY_CONFLICT", message: "Writers raced", retryable: true },
    };
    const { t } = transport({}, () => json(body, 409));
    const error = await t.post("/payment-intents", {}).catch((e: unknown) => e);
    expect((error as MayarinApiError).retryable).toBe(true);
  });

  test("a permanent provider failure stays non-retryable", async () => {
    const body = {
      error: { code: "PROVIDER_ERROR", message: "Route refused", retryable: false },
    };
    const { t } = transport({}, () => json(body, 502));
    const error = await t.post("/payment-intents", {}).catch((e: unknown) => e);
    expect((error as MayarinApiError).retryable).toBe(false);
  });

  test("a non-JSON error body still maps to the one error type", async () => {
    const { t } = transport({}, () => new Response("<html>bad gateway</html>", { status: 502 }));
    const error = await t.get("/health").catch((e: unknown) => e);
    expect(isMayarinApiError(error)).toBe(true);
    expect((error as MayarinApiError).code).toBe("INVALID_RESPONSE");
    expect((error as MayarinApiError).status).toBe(502);
  });

  test("a network fault maps to NETWORK_ERROR and is retryable", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const t = createTransport({ baseUrl: "https://api.test", fetch: failing });
    const error = await t.get("/health").catch((e: unknown) => e);
    expect(isMayarinApiError(error)).toBe(true);
    expect((error as MayarinApiError).code).toBe("NETWORK_ERROR");
    expect((error as MayarinApiError).status).toBe(0);
    expect((error as MayarinApiError).retryable).toBe(true);
  });

  test("a 2xx body that is not JSON maps to INVALID_RESPONSE", async () => {
    const { t } = transport({}, () => new Response("plain text", { status: 200 }));
    const error = await t.get("/health").catch((e: unknown) => e);
    expect((error as MayarinApiError).code).toBe("INVALID_RESPONSE");
  });
});
