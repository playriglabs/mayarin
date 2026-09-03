/**
 * The HTTP transport: three base64 headers and nothing else.
 *
 * Pure on purpose. The Hono middleware reads and writes headers; this file
 * decides what a header means, so the protocol can be tested without a server
 * and re-used by the MCP transport, which carries the same JSON under different
 * names.
 *
 * Spec: https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md
 */

import { ValidationError } from "@mayarin/shared";
import type { PaymentPayload, PaymentRequired, SettleResponse } from "../types.ts";
import { X402_VERSION } from "../types.ts";

/** Server → client, alongside `402 Payment Required`. */
export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
/** Client → server, carrying the signed authorization. */
export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
/** Server → client, once settlement has been attempted. */
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";

export const PAYMENT_REQUIRED_STATUS = 402;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function decode(header: string, name: string): unknown {
  let json: string;
  try {
    json = Buffer.from(header, "base64").toString("utf8");
  } catch {
    throw new ValidationError(`${name} is not valid base64`);
  }
  try {
    return JSON.parse(json) as unknown;
  } catch {
    throw new ValidationError(`${name} does not decode to JSON`);
  }
}

export function encodePaymentRequired(value: PaymentRequired): string {
  return encode(value);
}

export function encodeSettleResponse(value: SettleResponse): string {
  return encode(value);
}

/**
 * Decode a `PAYMENT-SIGNATURE` header into a payload.
 *
 * Structural validation only — that the fields exist and have the right shape.
 * Whether the signature is good, the payer funded, or the amount right is the
 * scheme's and the facilitator's business, and doing any of it here would put
 * chain access inside a codec.
 */
export function decodePaymentPayload(header: string): PaymentPayload {
  const value = decode(header, PAYMENT_SIGNATURE_HEADER);
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`${PAYMENT_SIGNATURE_HEADER} must decode to an object`);
  }
  const candidate = value as Record<string, unknown>;

  // Version first: a v1 payload has a different payload shape, and reporting
  // "accepted is missing" for one would send an integrator hunting the wrong
  // bug.
  if (candidate.x402Version !== X402_VERSION) {
    throw new ValidationError(
      `x402Version must be ${X402_VERSION}, received ${String(candidate.x402Version)}`,
    );
  }
  if (typeof candidate.accepted !== "object" || candidate.accepted === null) {
    throw new ValidationError(`${PAYMENT_SIGNATURE_HEADER} is missing "accepted"`);
  }
  if (typeof candidate.payload !== "object" || candidate.payload === null) {
    throw new ValidationError(`${PAYMENT_SIGNATURE_HEADER} is missing "payload"`);
  }

  return candidate as unknown as PaymentPayload;
}

/** Decode a `PAYMENT-REQUIRED` header. Used by a client, and by our own tests. */
export function decodePaymentRequired(header: string): PaymentRequired {
  const value = decode(header, PAYMENT_REQUIRED_HEADER);
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`${PAYMENT_REQUIRED_HEADER} must decode to an object`);
  }
  return value as PaymentRequired;
}

/** Decode a `PAYMENT-RESPONSE` header. */
export function decodeSettleResponse(header: string): SettleResponse {
  const value = decode(header, PAYMENT_RESPONSE_HEADER);
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`${PAYMENT_RESPONSE_HEADER} must decode to an object`);
  }
  return value as SettleResponse;
}
