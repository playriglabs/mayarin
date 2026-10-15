import { describe, expect, test } from "bun:test";
import { capBytes } from "./proxy-limits";

async function read(stream: ReadableStream<Uint8Array>): Promise<number> {
  let total = 0;
  for await (const chunk of stream) total += chunk.byteLength;
  return total;
}

function bytes(...sizes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const size of sizes) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
}

describe("capBytes", () => {
  test("passes a body within the limit", async () => {
    expect(await read(bytes(4, 4).pipeThrough(capBytes(8)))).toBe(8);
  });

  test("errors the stream once the limit is exceeded", async () => {
    await expect(read(bytes(4, 5).pipeThrough(capBytes(8)))).rejects.toThrow("Body too large");
  });
});
