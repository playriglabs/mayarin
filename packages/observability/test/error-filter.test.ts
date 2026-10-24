import { describe, expect, test } from "bun:test";
import { createErrorFilter } from "../src/index.ts";

describe("error filter", () => {
  test("drops a refused request but keeps a server failure", () => {
    const send = createErrorFilter(() => 0);
    expect(send("[api] POST /v1/quotes -> 400 VALIDATION_ERROR: bad amount")).toBe(false);
    expect(send("[api] GET /v1/payments/x -> 502 PROVIDER_ERROR: oracle down")).toBe(true);
  });

  test("sends the same message once a minute", () => {
    let now = 0;
    const send = createErrorFilter(() => now);
    expect(send("[chain-worker] resume pass failed")).toBe(true);
    now = 30_000;
    expect(send("[chain-worker] resume pass failed")).toBe(false);
    now = 61_000;
    expect(send("[chain-worker] resume pass failed")).toBe(true);
  });

  test("a different message is not held back by another", () => {
    const send = createErrorFilter(() => 0);
    expect(send("a")).toBe(true);
    expect(send("b")).toBe(true);
  });
});
