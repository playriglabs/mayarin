import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import { idempotencyKeyOf } from "../src/index.ts";
import {
  EXAMPLE_AUTHORIZATION,
  EXAMPLE_PAYMENT_PAYLOAD,
  withAccepted,
  withAuthorization,
} from "../testing/index.ts";

describe("idempotencyKeyOf", () => {
  test("keys on network, asset and nonce together", () => {
    expect(idempotencyKeyOf(EXAMPLE_PAYMENT_PAYLOAD)).toBe(
      `x402:eip155:84532:0x036cbd53842c5426634e7929541ec2318f3dcf7e:${EXAMPLE_AUTHORIZATION.nonce}`,
    );
  });

  test("gives the same key to the same payload replayed", () => {
    expect(idempotencyKeyOf(EXAMPLE_PAYMENT_PAYLOAD)).toBe(
      idempotencyKeyOf(structuredClone(EXAMPLE_PAYMENT_PAYLOAD)),
    );
  });

  // A nonce is unique within one token on one chain and nowhere else. The same
  // 32 bytes are a perfectly valid, unrelated authorization elsewhere, and
  // keying on the nonce alone would refuse it as a replay.
  test.each([
    ["network", withAccepted({ network: "eip155:296" })],
    ["asset", withAccepted({ asset: `0x${"44".repeat(20)}` })],
    ["nonce", withAuthorization({ nonce: `0x${"55".repeat(32)}` })],
  ])("distinguishes payments differing only by %s", (_label, other) => {
    expect(idempotencyKeyOf(other)).not.toBe(idempotencyKeyOf(EXAMPLE_PAYMENT_PAYLOAD));
  });

  // Otherwise the replay guard is defeated by changing the case of a hex digit,
  // which every checksumming client does by default.
  test("is unchanged by address and nonce casing", () => {
    const upper = withAccepted({
      asset: EXAMPLE_PAYMENT_PAYLOAD.accepted.asset.toUpperCase().replace("0X", "0x"),
    });
    const shouted = {
      ...upper,
      payload: {
        ...upper.payload,
        authorization: {
          ...EXAMPLE_AUTHORIZATION,
          nonce: EXAMPLE_AUTHORIZATION.nonce.toUpperCase().replace("0X", "0x"),
        },
      },
    };

    expect(idempotencyKeyOf(shouted)).toBe(idempotencyKeyOf(EXAMPLE_PAYMENT_PAYLOAD));
  });

  test("refuses a nonce that is not 32 bytes", () => {
    expect(() => idempotencyKeyOf(withAuthorization({ nonce: "0x01" }))).toThrow(ValidationError);
  });
});
