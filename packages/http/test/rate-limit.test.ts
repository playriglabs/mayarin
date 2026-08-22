import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { rateLimit } from "../src/rate-limit.ts";

function subject(
  options: {
    readonly limit?: number;
    readonly windowMs?: number;
    readonly blockDurationMs?: number;
    readonly maxClients?: number;
  } = {},
) {
  let nowMs = 0;
  const app = new Hono();
  app.use(
    "*",
    rateLimit({
      limit: options.limit ?? 2,
      windowMs: options.windowMs ?? 1_000,
      clientIpSource: "x-forwarded-for",
      ...(options.blockDurationMs === undefined
        ? {}
        : { blockDurationMs: options.blockDurationMs }),
      ...(options.maxClients === undefined ? {} : { maxClients: options.maxClients }),
      now: () => nowMs,
    }),
  );
  app.get("/", (c) => c.json({ ok: true }));

  return {
    request: (client = "203.0.113.10", method = "GET") =>
      app.request("/", { method, headers: { "x-forwarded-for": client } }),
    advance: (milliseconds: number) => {
      nowMs += milliseconds;
    },
  };
}

describe("rateLimit", () => {
  test("returns 429 with retry guidance after the client exhausts its bucket", async () => {
    const app = subject();

    expect((await app.request()).status).toBe(200);
    const second = await app.request();
    expect(second.status).toBe(200);
    expect(second.headers.get("ratelimit-remaining")).toBe("0");

    const rejected = await app.request();
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("1");
    expect(await rejected.json()).toEqual({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: "Too many requests. Try again later.",
        retryable: true,
        details: { retryAfterSeconds: 1 },
      },
    });
  });

  test("refills steadily and keeps clients independent", async () => {
    const app = subject();

    await app.request("203.0.113.10");
    await app.request("203.0.113.10");
    expect((await app.request("198.51.100.20")).status).toBe(200);

    app.advance(500);
    expect((await app.request("203.0.113.10")).status).toBe(200);
  });

  test("keeps an exhausted client blocked for the fixed penalty without extending it", async () => {
    const app = subject({ limit: 1, windowMs: 1_000, blockDurationMs: 5 * 60 * 1_000 });

    expect((await app.request()).status).toBe(200);
    const rejected = await app.request();
    expect(rejected.status).toBe(429);
    expect(rejected.headers.get("retry-after")).toBe("300");

    app.advance(4 * 60 * 1_000);
    const stillBlocked = await app.request();
    expect(stillBlocked.status).toBe(429);
    expect(stillBlocked.headers.get("retry-after")).toBe("60");

    app.advance(60 * 1_000);
    expect((await app.request()).status).toBe(200);
  });

  test("does not charge CORS preflight requests", async () => {
    const app = subject({ limit: 1 });

    expect((await app.request("203.0.113.10", "OPTIONS")).status).toBe(404);
    expect((await app.request()).status).toBe(200);
  });

  test("bounds memory by pooling excess client identities", async () => {
    const app = subject({ limit: 1, maxClients: 1 });

    expect((await app.request("203.0.113.10")).status).toBe(200);
    expect((await app.request("198.51.100.20")).status).toBe(200);
    expect((await app.request("192.0.2.30")).status).toBe(429);
  });

  test("uses only the explicitly selected trusted proxy header", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({
        limit: 1,
        windowMs: 1_000,
        clientIpSource: "x-real-ip",
        now: () => 0,
      }),
    );
    app.get("/", (c) => c.json({ ok: true }));

    expect(
      (
        await app.request("/", {
          headers: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.20" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/", {
          headers: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "192.0.2.30" },
        })
      ).status,
    ).toBe(429);
  });

  test("keeps Cloudflare-proxied requests in the visitor's bucket", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({
        limit: 1,
        windowMs: 1_000,
        clientIpSource: "cf-connecting-ip",
        now: () => 0,
      }),
    );
    app.get("/", (c) => c.json({ ok: true }));

    expect(
      (
        await app.request("/", {
          headers: { "cf-connecting-ip": "203.0.113.10", "x-real-ip": "198.51.100.20" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request("/", {
          headers: { "cf-connecting-ip": "203.0.113.10", "x-real-ip": "192.0.2.30" },
        })
      ).status,
    ).toBe(429);
  });
});
