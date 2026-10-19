import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { ORIGIN_SECRET_HEADER, originSecret } from "../src/origin-secret.ts";

const SECRET = "s".repeat(40);

function app(secret: string | undefined) {
  const hono = new Hono();
  hono.use("*", originSecret({ secret }));
  hono.get("/health", (c) => c.text("ok"));
  hono.get("/v1/thing", (c) => c.json({ ok: true }));
  return hono;
}

describe("originSecret (SEC-13)", () => {
  test("a request from the edge, carrying the secret, passes", async () => {
    const response = await app(SECRET).request("/v1/thing", {
      headers: { [ORIGIN_SECRET_HEADER]: SECRET },
    });
    expect(response.status).toBe(200);
  });

  test("a direct hit on the origin without it is a 404, like a path that does not exist", async () => {
    const response = await app(SECRET).request("/v1/thing");
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  test("a wrong secret, of the same length or not, is refused", async () => {
    for (const wrong of ["w".repeat(40), "short", "", `${SECRET}x`]) {
      const response = await app(SECRET).request("/v1/thing", {
        headers: { [ORIGIN_SECRET_HEADER]: wrong },
      });
      expect(response.status).toBe(404);
    }
  });

  test("the health probe is answered without it", async () => {
    expect((await app(SECRET).request("/health")).status).toBe(200);
  });

  test("with no secret configured nothing is checked", async () => {
    expect((await app(undefined).request("/v1/thing")).status).toBe(200);
  });
});
