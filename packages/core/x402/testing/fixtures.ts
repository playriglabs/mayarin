/**
 * The specification's own example payloads, transcribed field for field.
 *
 * These are fixtures rather than builders because their value is that nobody
 * chose them: they come from
 * https://github.com/coinbase/x402/blob/main/specs/x402-specification-v2.md and
 * https://github.com/coinbase/x402/blob/main/specs/transports-v2/http.md, so a
 * round-trip test against them proves this implementation agrees with the
 * document rather than with itself.
 *
 * `withRequirements` and `withAuthorization` exist for the cases that need one
 * field changed — a wrong recipient, an expired window — without restating an
 * object whose point is that it is unmodified.
 */

import type {
  Authorization,
  Eip3009Payload,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  ResourceInfo,
} from "../src/types.ts";
import { X402_VERSION } from "../src/types.ts";

export const EXAMPLE_RESOURCE: ResourceInfo = {
  url: "https://api.example.com/premium-data",
  description: "Access to premium market data",
  mimeType: "application/json",
};

/** USDC on Base Sepolia, ten thousand atomic units — one US cent. */
export const EXAMPLE_REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: "eip155:84532",
  amount: "10000",
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2" },
};

export const EXAMPLE_PAYMENT_REQUIRED: PaymentRequired = {
  x402Version: X402_VERSION,
  error: "PAYMENT-SIGNATURE header is required",
  resource: EXAMPLE_RESOURCE,
  accepts: [EXAMPLE_REQUIREMENTS],
};

export const EXAMPLE_AUTHORIZATION: Authorization = {
  from: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
  to: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  value: "10000",
  validAfter: "1740672089",
  validBefore: "1740672154",
  nonce: "0xf3746613c2d920b5fdabc0856f2aeb2d4f88ee6037b8cc5d04a71a4462f13480",
};

/** An instant inside the example authorization's window. */
export const EXAMPLE_WITHIN_WINDOW = new Date(1_740_672_120 * 1000);

export const EXAMPLE_EIP3009_PAYLOAD: Eip3009Payload = {
  signature:
    "0x2d6a7588d6acca505cbf0d9a4a227e0c52c6c34008c8e8986a1283259764173608a2ce6496642e377d6da8dbbf5836e9bd15092f9ecab05ded3d6293af148b571c",
  authorization: EXAMPLE_AUTHORIZATION,
};

export const EXAMPLE_PAYMENT_PAYLOAD: PaymentPayload = {
  x402Version: X402_VERSION,
  resource: EXAMPLE_RESOURCE,
  accepted: EXAMPLE_REQUIREMENTS,
  payload: { ...EXAMPLE_EIP3009_PAYLOAD },
};

/**
 * The example requirements with no `extra` at all — the token domain missing
 * rather than incomplete. Built by omission rather than by spreading
 * `undefined`, which `exactOptionalPropertyTypes` correctly refuses.
 */
export function withoutExtra(): PaymentRequirements {
  const { extra: _extra, ...rest } = EXAMPLE_REQUIREMENTS;
  return rest;
}

export function withRequirements(overrides: Partial<PaymentRequirements>): PaymentRequirements {
  return { ...EXAMPLE_REQUIREMENTS, ...overrides };
}

/** A payload whose `accepted` and authorization both carry the overrides. */
export function withAuthorization(overrides: Partial<Authorization>): PaymentPayload {
  return {
    ...EXAMPLE_PAYMENT_PAYLOAD,
    payload: {
      ...EXAMPLE_EIP3009_PAYLOAD,
      authorization: { ...EXAMPLE_AUTHORIZATION, ...overrides },
    },
  };
}

/** A payload whose echoed `accepted` differs from what the resource asked for. */
export function withAccepted(overrides: Partial<PaymentRequirements>): PaymentPayload {
  return { ...EXAMPLE_PAYMENT_PAYLOAD, accepted: withRequirements(overrides) };
}
