import { describe, expect, test } from "bun:test";
import { StaleCache } from "../src/stale-cache.ts";

function harness(options: { freshMs?: number; staleMs?: number } = {}) {
  let now = 0;
  const loads: string[] = [];
  let release: (() => void) | undefined;
  let hold: Promise<void> | undefined;
  let next: { value: string; keep: boolean } = { value: "v1", keep: true };
  const cache = new StaleCache<string>({
    freshMs: options.freshMs ?? 1_000,
    staleMs: options.staleMs ?? 10_000,
    now: () => now,
    load: async (key) => {
      loads.push(key);
      if (hold !== undefined) await hold;
      return next;
    },
  });
  return {
    cache,
    loads,
    advance: (ms: number) => {
      now += ms;
    },
    set: (value: string, keep = true) => {
      next = { value, keep };
    },
    pause: () => {
      hold = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    resume: () => {
      release?.();
      hold = undefined;
    },
  };
}

describe("StaleCache", () => {
  test("serves a fresh answer without loading again", async () => {
    const h = harness();
    expect(await h.cache.get("a")).toBe("v1");
    h.advance(500);
    expect(await h.cache.get("a")).toBe("v1");
    expect(h.loads).toEqual(["a"]);
  });

  test("everyone asking for a key with no answer waits on one load", async () => {
    const h = harness();
    h.pause();
    const first = h.cache.get("a");
    const second = h.cache.get("a");
    h.resume();
    expect(await Promise.all([first, second])).toEqual(["v1", "v1"]);
    expect(h.loads).toEqual(["a"]);
  });

  test("a stale answer is served at once and refreshed behind the caller", async () => {
    const h = harness();
    await h.cache.get("a");
    h.advance(5_000);
    h.set("v2");
    h.pause();
    // Not waiting for the load: the old answer comes back while it is still held.
    expect(await h.cache.get("a")).toBe("v1");
    h.resume();
    await Bun.sleep(0);
    expect(await h.cache.get("a")).toBe("v2");
    expect(h.loads).toEqual(["a", "a"]);
  });

  test("an answer past the stale window is waited for", async () => {
    const h = harness();
    await h.cache.get("a");
    h.advance(20_000);
    h.set("v2");
    expect(await h.cache.get("a")).toBe("v2");
  });

  test("an answer that is not kept is returned but never replaces a good one", async () => {
    const h = harness();
    await h.cache.get("a");
    h.advance(5_000);
    h.set("down", false);
    expect(await h.cache.get("a")).toBe("v1");
    await Bun.sleep(0);
    // The failed refresh stored nothing, so the old answer is still what is served.
    expect(await h.cache.get("a")).toBe("v1");
    expect(h.loads).toHaveLength(3);
  });

  test("a cold key that fails to load is asked again next time", async () => {
    const h = harness();
    h.set("down", false);
    expect(await h.cache.get("a")).toBe("down");
    h.set("v1");
    expect(await h.cache.get("a")).toBe("v1");
    expect(h.loads).toEqual(["a", "a"]);
  });
});
