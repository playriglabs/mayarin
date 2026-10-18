import { describe, expect, test } from "bun:test";
import { scopedIdempotencyKey } from "../src/idempotency.ts";

describe("scopedIdempotencyKey (SEC-02, SEC-10)", () => {
  test("one key on two operations is two keys", () => {
    expect(scopedIdempotencyKey("mrc_1", "payment-intent", "k")).not.toBe(
      scopedIdempotencyKey("mrc_1", "cart-checkout", "k"),
    );
  });

  test("one key under two tenants is two keys", () => {
    expect(scopedIdempotencyKey("mrc_1", "refund", "k")).not.toBe(
      scopedIdempotencyKey("mrc_2", "refund", "k"),
    );
  });

  test("a colon in the caller's key cannot move the boundary", () => {
    expect(scopedIdempotencyKey("mrc_1", "refund", "cart-checkout:k")).not.toBe(
      scopedIdempotencyKey("mrc_1", "cart-checkout", "k"),
    );
  });
});
