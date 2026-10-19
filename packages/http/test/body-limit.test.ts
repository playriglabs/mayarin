import { describe, expect, test } from "bun:test";
import { bodyCeilingFor, MAX_JSON_BODY_BYTES } from "../src/body-limit.ts";

describe("body ceilings (SEC-08)", () => {
  test("an upload's ceiling leaves room above its own cap", () => {
    const cap = 2 * 1024 * 1024;
    expect(bodyCeilingFor(cap)).toBeGreaterThan(cap);
    expect(bodyCeilingFor(0)).toBe(MAX_JSON_BODY_BYTES);
  });

  test("Bun refuses a body past the ceiling, whether it declares a length or streams", async () => {
    let handled = 0;
    const server = Bun.serve({
      port: 0,
      maxRequestBodySize: MAX_JSON_BODY_BYTES,
      fetch: async (request) => {
        handled += 1;
        return new Response(String((await request.text()).length));
      },
    });
    try {
      const url = `http://localhost:${server.port}/`;
      const small = await fetch(url, { method: "POST", body: "x".repeat(1_000) });
      expect(small.status).toBe(200);

      const declared = await fetch(url, {
        method: "POST",
        body: "x".repeat(MAX_JSON_BODY_BYTES + 1),
      });
      expect(declared.status).toBe(413);
      // Declared up front, it never reaches the handler.
      expect(handled).toBe(1);

      const chunk = new Uint8Array(64 * 1024);
      const chunked = await fetch(url, {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            for (let i = 0; i < 32; i += 1) controller.enqueue(chunk);
            controller.close();
          },
        }),
        // @ts-expect-error Bun needs this to stream a request body
        duplex: "half",
      });
      // Streamed, the handler starts and the read is cut off at the ceiling.
      expect(chunked.status).toBe(413);
    } finally {
      await server.stop(true);
    }
  });
});
