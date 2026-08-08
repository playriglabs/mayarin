import { afterAll, describe, expect, test } from "bun:test";
import { FetchWebhookTransport } from "../src/services/webhook-transport.ts";

/**
 * The RFC's stalled-receiver criterion: a merchant endpoint that hangs must
 * become a failed attempt on the dispatcher's schedule, never a hang in the
 * delivery loop. Delivery already runs outside the payment path and outside
 * any database transaction; the timeout is what bounds the loop itself.
 */
describe("FetchWebhookTransport", () => {
  const stalled = Bun.serve({
    port: 0,
    fetch: () => new Promise<Response>(() => {}),
  });
  const redirecting = Bun.serve({
    port: 0,
    fetch: () => Response.redirect("https://elsewhere.example/hook", 302),
  });

  afterAll(() => {
    stalled.stop(true);
    redirecting.stop(true);
  });

  test("a stalled receiver becomes a failed attempt, not a hang", async () => {
    const transport = new FetchWebhookTransport({ timeoutMs: 150 });
    const started = Date.now();

    await expect(
      transport.post({ url: `http://127.0.0.1:${stalled.port}/hook`, body: "{}", headers: {} }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test("a redirect is refused rather than followed", async () => {
    const transport = new FetchWebhookTransport({ timeoutMs: 1_000 });

    await expect(
      transport.post({
        url: `http://127.0.0.1:${redirecting.port}/hook`,
        body: "{}",
        headers: {},
      }),
    ).rejects.toThrow();
  });
});
