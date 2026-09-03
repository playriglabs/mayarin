/**
 * The idempotency key for an x402 payment.
 *
 * EIP-3009 already makes a nonce single-use: the token records it and a second
 * `transferWithAuthorization` with the same one reverts. So the chain cannot be
 * double-spent, and this key is not there for that.
 *
 * It is there for the window before the chain is asked. A replayed
 * `PAYMENT-SIGNATURE` header — the same bytes posted twice, by a retrying
 * client or by someone who copied them — reaches the resource server twice, and
 * without a key both requests would open a payment intent, take a quote and
 * post to the ledger. The second one's settlement would then fail on-chain,
 * correctly, having already written a posting that has no money behind it.
 *
 * The key is scoped by network and asset as well as nonce because a nonce is
 * only unique within one token on one chain. The same 32 bytes are a perfectly
 * valid, unrelated authorization on another.
 */

import { ValidationError } from "@mayarin/shared";
import { eip3009PayloadOf } from "./scheme/exact-evm.ts";
import type { PaymentPayload } from "./types.ts";

const BYTES32 = /^0x[\da-f]{64}$/i;

export function idempotencyKeyOf(payment: PaymentPayload): string {
  const { authorization } = eip3009PayloadOf(payment);
  if (!BYTES32.test(authorization.nonce)) {
    throw new ValidationError("x402 authorization nonce must be 32 bytes");
  }
  // Lowercased so a client that checksums its addresses and one that does not
  // produce the same key for the same payment — otherwise the replay guard is
  // defeated by changing the case of a hex digit.
  return [
    "x402",
    payment.accepted.network,
    payment.accepted.asset.toLowerCase(),
    authorization.nonce.toLowerCase(),
  ].join(":");
}
