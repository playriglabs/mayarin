import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type SecurityEvent, securityEvents } from "../src/security-events.ts";

function harness() {
  const events: SecurityEvent[] = [];
  const app = new Hono<{ Variables: { actor: string; tenant: string } }>();
  app.use(
    "*",
    securityEvents({
      service: "test",
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      write: (event) => events.push(event),
      identify: (c) => ({ actor: c.get("actor"), tenant: c.get("tenant") }),
    }),
  );
  app.use("*", async (c, next) => {
    if (c.req.header("x-as") !== undefined) {
      c.set("actor", "usr_1");
      c.set("tenant", "mrc_1");
    }
    await next();
  });
  app.post("/payments/:id/refunds", (c) => c.json({ ok: true }, 201));
  app.get("/payments/:id", (c) => c.json({ ok: true }));
  app.get("/private", (c) => c.json({ error: "no" }, 401));
  app.post("/boom", (c) => c.json({ error: "x" }, 500));
  return { app, events };
}

describe("security events (SEC-22)", () => {
  test("records a mutation with the route template, actor and tenant", async () => {
    const { app, events } = harness();

    await app.request("/payments/pay_secret123/refunds?token=abc", {
      method: "POST",
      headers: { "x-as": "1", authorization: "Bearer sk_live_secret", "cf-ray": "ray-1" },
      body: JSON.stringify({ password: "hunter2" }),
    });

    expect(events).toEqual([
      {
        type: "security",
        time: "2026-01-01T00:00:00.000Z",
        service: "test",
        requestId: "ray-1",
        method: "POST",
        route: "/payments/:id/refunds",
        status: 201,
        result: "success",
        actor: "usr_1",
        tenant: "mrc_1",
      },
    ]);
    // Nothing the caller sent can have reached the line.
    const line = JSON.stringify(events);
    for (const secret of ["pay_secret123", "abc", "sk_live_secret", "hunter2"]) {
      expect(line).not.toContain(secret);
    }
  });

  test("skips a successful read, keeps a refused one", async () => {
    const { app, events } = harness();

    await app.request("/payments/pay_1");
    expect(events).toHaveLength(0);

    await app.request("/private");
    expect(events).toHaveLength(1);
    expect(events[0]?.result).toBe("denied");
  });

  test("marks a server failure as an error, and answers with the request id", async () => {
    const { app, events } = harness();

    const response = await app.request("/boom", { method: "POST" });

    expect(events[0]?.result).toBe("error");
    expect(response.headers.get("x-request-id")).toBe(events[0]?.requestId ?? "");
  });
});
