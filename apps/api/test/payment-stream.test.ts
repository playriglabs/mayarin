/**
 * Live payment status tests (#13).
 *
 * The fan-out and its bounds. The Postgres transport is not under test here —
 * it is injected, so these assert what the process does with a change once it
 * hears about one.
 */

import { describe, expect, test } from "bun:test";
import type { PaymentChangeSubscription } from "@mayarin/db";
import { PaymentStream } from "../src/services/payment-stream.ts";

function harness(maxWatchedPayments?: number) {
  let onChange: ((paymentIntentId: string) => void) | undefined;
  let unlistened = false;

  const stream = new PaymentStream({
    subscribe: async (handler): Promise<PaymentChangeSubscription> => {
      onChange = handler;
      return {
        unlisten: async () => {
          unlistened = true;
          onChange = undefined;
        },
      };
    },
    ...(maxWatchedPayments === undefined ? {} : { maxWatchedPayments }),
  });

  return {
    stream,
    commit: (id: string) => onChange?.(id),
    get unlistened() {
      return unlistened;
    },
  };
}

describe("fan-out", () => {
  test("every watcher of a payment is told", async () => {
    const { stream, commit } = harness();
    await stream.start();

    const seen: string[] = [];
    stream.watch("pi_1", () => seen.push("a"));
    stream.watch("pi_1", () => seen.push("b"));

    commit("pi_1");

    expect(seen).toEqual(["a", "b"]);
  });

  test("a watcher of another payment is not", async () => {
    const { stream, commit } = harness();
    await stream.start();

    let told = false;
    stream.watch("pi_1", () => {
      told = true;
    });

    commit("pi_2");

    expect(told).toBe(false);
  });

  test("one watcher throwing does not stop the others", async () => {
    const { stream, commit } = harness();
    await stream.start();

    let second = false;
    stream.watch("pi_1", () => {
      throw new Error("connection already gone");
    });
    stream.watch("pi_1", () => {
      second = true;
    });

    expect(() => commit("pi_1")).not.toThrow();
    expect(second).toBe(true);
  });
});

describe("bounds", () => {
  test("unwatching drops the entry once nobody is left", async () => {
    const { stream } = harness();
    await stream.start();

    const stopA = stream.watch("pi_1", () => {});
    const stopB = stream.watch("pi_1", () => {});
    expect(stream.watchedCount).toBe(1);

    stopA?.();
    // Still watched: one subscriber remains.
    expect(stream.watchedCount).toBe(1);

    stopB?.();
    // An idle process must not hold entries for payments that finished hours ago.
    expect(stream.watchedCount).toBe(0);
  });

  test("a new payment past the ceiling is refused, not queued", async () => {
    const { stream } = harness(1);
    await stream.start();

    expect(stream.watch("pi_1", () => {})).toBeDefined();
    // The caller is expected to fall back to polling — a payer who cannot
    // stream must still be able to pay.
    expect(stream.watch("pi_2", () => {})).toBeUndefined();
  });

  test("the ceiling counts payments, not watchers", async () => {
    const { stream } = harness(1);
    await stream.start();

    stream.watch("pi_1", () => {});
    // A second watcher of an already-watched payment costs no new entry.
    expect(stream.watch("pi_1", () => {})).toBeDefined();
  });

  test("an unstarted stream tells nobody", () => {
    const { stream, commit } = harness();

    let told = false;
    stream.watch("pi_1", () => {
      told = true;
    });

    commit("pi_1");
    expect(told).toBe(false);
  });

  test("starting twice opens one listener", async () => {
    const { stream, commit } = harness();
    await stream.start();
    await stream.start();

    let count = 0;
    stream.watch("pi_1", () => {
      count += 1;
    });
    commit("pi_1");

    expect(count).toBe(1);
  });

  test("stopping releases the listener and forgets the watchers", async () => {
    const context = harness();
    await context.stream.start();
    context.stream.watch("pi_1", () => {});

    await context.stream.stop();

    expect(context.unlistened).toBe(true);
    expect(context.stream.watchedCount).toBe(0);
  });
});
