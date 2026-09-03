import { describe, expect, test } from "bun:test";
import { ValidationError } from "@mayarin/shared";
import {
  decodePaymentPayload,
  decodePaymentRequired,
  decodeSettleResponse,
  encodePaymentRequired,
  encodeSettleResponse,
  PAYMENT_REQUIRED_STATUS,
} from "../src/transport/http.ts";
import type { SettleResponse } from "../src/types.ts";
import { EXAMPLE_PAYMENT_PAYLOAD, EXAMPLE_PAYMENT_REQUIRED } from "../testing/fixtures.ts";

/**
 * The header value from the specification's HTTP transport document. Decoding
 * it is the one test here that proves this implementation agrees with the
 * document rather than with its own encoder.
 */
const SPEC_PAYMENT_SIGNATURE =
  "eyJ4NDAyVmVyc2lvbiI6MiwicmVzb3VyY2UiOnsidXJsIjoiaHR0cHM6Ly9hcGkuZXhhbXBsZS5jb20vcHJlbWl1bS1kYXRhIiwiZGVzY3JpcHRpb24iOiJBY2Nlc3MgdG8gcHJlbWl1bSBtYXJrZXQgZGF0YSIsIm1pbWVUeXBlIjoiYXBwbGljYXRpb24vanNvbiJ9LCJhY2NlcHRlZCI6eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJlaXAxNTU6ODQ1MzIiLCJhbW91bnQiOiIxMDAwMCIsImFzc2V0IjoiMHgwMzZDYkQ1Mzg0MmM1NDI2NjM0ZTc5Mjk1NDFlQzIzMThmM2RDRjdlIiwicGF5VG8iOiIweDIwOTY5M0JjNmFmYzBDNTMyOGJBMzZGYUYwM0M1MTRFRjMxMjI4N0MiLCJtYXhUaW1lb3V0U2Vjb25kcyI6NjAsImV4dHJhIjp7Im5hbWUiOiJVU0RDIiwidmVyc2lvbiI6IjIifX0sInBheWxvYWQiOnsic2lnbmF0dXJlIjoiMHgyZDZhNzU4OGQ2YWNjYTUwNWNiZjBkOWE0YTIyN2UwYzUyYzZjMzQwMDhjOGU4OTg2YTEyODMyNTk3NjQxNzM2MDhhMmNlNjQ5NjY0MmUzNzdkNmRhOGRiYmY1ODM2ZTliZDE1MDkyZjllY2FiMDVkZWQzZDYyOTNhZjE0OGI1NzFjIiwiYXV0aG9yaXphdGlvbiI6eyJmcm9tIjoiMHg4NTdiMDY1MTlFOTFlM0E1NDUzODc5MWJEYmIwRTIyMzczZTM2YjY2IiwidG8iOiIweDIwOTY5M0JjNmFmYzBDNTMyOGJBMzZGYUYwM0M1MTRFRjMxMjI4N0MiLCJ2YWx1ZSI6IjEwMDAwIiwidmFsaWRBZnRlciI6IjE3NDA2NzIwODkiLCJ2YWxpZEJlZm9yZSI6IjE3NDA2NzIxNTQiLCJub25jZSI6IjB4ZjM3NDY2MTNjMmQ5MjBiNWZkYWJjMDg1NmYyYWViMmQ0Zjg4ZWU2MDM3YjhjYzVkMDRhNzFhNDQ2MmYxMzQ4MCJ9fX0=";

describe("PAYMENT-SIGNATURE", () => {
  test("decodes the specification's own header verbatim", () => {
    const payload = decodePaymentPayload(SPEC_PAYMENT_SIGNATURE);

    expect(payload).toEqual(EXAMPLE_PAYMENT_PAYLOAD);
  });

  // A v1 payload carries a different payload shape. Reporting a missing field
  // instead of a version mismatch would send an integrator hunting the wrong
  // bug entirely.
  test("names the version before it names a missing field", () => {
    const header = Buffer.from(JSON.stringify({ x402Version: 1 })).toString("base64");

    expect(() => decodePaymentPayload(header)).toThrow(/x402Version must be 2/);
  });

  test.each([
    ["not base64 at all", "!!!!"],
    ["base64 of something that is not JSON", Buffer.from("hello").toString("base64")],
    ["JSON that is not an object", Buffer.from("[1,2,3]").toString("base64")],
  ])("rejects %s", (_label, header) => {
    expect(() => decodePaymentPayload(header)).toThrow(ValidationError);
  });

  test.each([
    ["accepted", { x402Version: 2, payload: {} }],
    ["payload", { x402Version: 2, accepted: {} }],
  ])("rejects a payload missing %s", (field, value) => {
    const header = Buffer.from(JSON.stringify(value)).toString("base64");

    expect(() => decodePaymentPayload(header)).toThrow(new RegExp(field));
  });

  // Structural validation only. Whether the signature recovers, the payer is
  // funded or the window is open belongs to the scheme and the facilitator —
  // doing any of it here would put chain access inside a codec.
  test("accepts a structurally valid payload carrying nonsense", () => {
    const header = Buffer.from(
      JSON.stringify({ x402Version: 2, accepted: {}, payload: { signature: "nope" } }),
    ).toString("base64");

    expect(() => decodePaymentPayload(header)).not.toThrow();
  });
});

describe("PAYMENT-REQUIRED", () => {
  test("round-trips", () => {
    expect(decodePaymentRequired(encodePaymentRequired(EXAMPLE_PAYMENT_REQUIRED))).toEqual(
      EXAMPLE_PAYMENT_REQUIRED,
    );
  });

  test("is the status the transport pairs it with", () => {
    expect(PAYMENT_REQUIRED_STATUS).toBe(402);
  });
});

describe("PAYMENT-RESPONSE", () => {
  const settled: SettleResponse = {
    success: true,
    transaction: `0x${"ab".repeat(32)}`,
    network: "eip155:84532",
    payer: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
  };

  test("round-trips", () => {
    expect(decodeSettleResponse(encodeSettleResponse(settled))).toEqual(settled);
  });

  // The empty string is the specification's own way of saying "no transaction",
  // and it must survive the round trip rather than becoming undefined: a
  // failure carrying a hash-shaped absence is how a failed payment gets read as
  // a settled one.
  test("preserves the empty transaction hash of a failed settlement", () => {
    const failed: SettleResponse = {
      success: false,
      errorReason: "insufficient_funds",
      transaction: "",
      network: "eip155:84532",
    };

    expect(decodeSettleResponse(encodeSettleResponse(failed))).toEqual(failed);
  });
});
