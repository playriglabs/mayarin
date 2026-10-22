import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { type SlowRequestEvent, slowRequests } from "../src/slow-requests.ts";

function harness(thresholdMs: number) {
  const events: SlowRequestEvent[] = [];
  let tick = 0;
  const app = new Hono();
  app.use(
    "*",
    slowRequests({
      service: "test",
      thresholdMs,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      // Each request reads the clock twice; the handler decides how far it moved.
      clock: () => tick,
      write: (event) => events.push(event),
    }),
  );
  app.get("/fast", (c) => c.json({ ok: true }));
  app.get("/slow/:id", (c) => {
    tick += 2_500;
    return c.json({ ok: true });
  });
  app.get("/stream", (c) => {
    tick += 60_000;
    return c.body("data: x\n\n", 200, { "content-type": "text/event-stream" });
  });
  return { app, events };
}

describe("slowRequests", () => {
  test("is silent for a request under the threshold", async () => {
    const { app, events } = harness(1_000);
    await app.request("/fast");
    expect(events).toEqual([]);
  });

  test("logs the template and the duration of a slow one, never the path value", async () => {
    const { app, events } = harness(1_000);
    await app.request("/slow/pay_01SECRET?token=abc");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "slow-request",
      service: "test",
      method: "GET",
      route: "/slow/:id",
      status: 200,
      durationMs: 2_500,
    });
    expect(JSON.stringify(events[0])).not.toContain("SECRET");
    expect(JSON.stringify(events[0])).not.toContain("token");
  });

  test("does not count an event stream's lifetime as slowness", async () => {
    const { app, events } = harness(1_000);
    await app.request("/stream");
    expect(events).toEqual([]);
  });
});
