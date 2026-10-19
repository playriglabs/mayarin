import { describe, expect, test } from "bun:test";
import { InMemoryNonceSequencer } from "../src/nonce-sequencer.ts";

describe("InMemoryNonceSequencer", () => {
  test("hands two concurrent submitters different nonces", async () => {
    const sequencer = new InMemoryNonceSequencer();
    const used: number[] = [];
    // A node that has not seen the first broadcast still answers 5.
    const observed = async () => 5;
    const send = async (nonce: number) => {
      used.push(nonce);
      return `0x${nonce}`;
    };

    await Promise.all([
      sequencer.broadcast("base:0xa", observed, send),
      sequencer.broadcast("base:0xa", observed, send),
      sequencer.broadcast("base:0xa", observed, send),
    ]);

    expect(used).toEqual([5, 6, 7]);
  });

  test("a failed send consumes nothing and rebuilds from the chain", async () => {
    const sequencer = new InMemoryNonceSequencer();
    await sequencer.broadcast(
      "k",
      async () => 5,
      async (n) => `0x${n}`,
    );
    await expect(
      sequencer.broadcast(
        "k",
        async () => 6,
        async () => Promise.reject(new Error("boom")),
      ),
    ).rejects.toThrow("boom");

    // The chain says 6 and the counter was discarded, so 6 it is.
    expect(
      await sequencer.broadcast(
        "k",
        async () => 6,
        async (n) => `0x${n}`,
      ),
    ).toBe("0x6");
  });

  test("keys do not wait on or share a counter", async () => {
    const sequencer = new InMemoryNonceSequencer();
    await sequencer.broadcast(
      "a",
      async () => 9,
      async (n) => `0x${n}`,
    );
    expect(
      await sequencer.broadcast(
        "b",
        async () => 2,
        async (n) => `0x${n}`,
      ),
    ).toBe("0x2");
  });
});
