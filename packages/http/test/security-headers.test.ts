import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { apiSecurityHeaders } from "../src/security-headers.ts";

describe("apiSecurityHeaders", () => {
  test("sets the policy on a success and on an error response", async () => {
    const app = new Hono();
    app.use("*", apiSecurityHeaders());
    app.get("/ok", (c) => c.json({ ok: true }));
    app.get("/boom", () => {
      throw new Error("boom");
    });

    for (const path of ["/ok", "/boom", "/missing"]) {
      const response = await app.request(path);
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("strict-transport-security")).toContain("max-age=");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });
});
